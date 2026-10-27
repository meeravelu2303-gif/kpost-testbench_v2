import { JUDGED_NOT_A_DEFECT, type BugzillaConfig } from '@config/bugzilla.config';
import { isPlainObject } from '@utils/json';
import type { Logger } from '@utils/logger';

/**
 * Bugzilla REST transport. The API key goes in the `api_key` query parameter (this 5.2 instance
 * ignores the header, and anonymous searches would duplicate every ticket); HTTP 200 with
 * `{"error": true}` is a failure; it never throws.
 */

export interface CallResult {
  ok: boolean;
  status?: number;
  json?: unknown;
  text?: string;
  error?: string;
}

export interface BugSummary {
  id: number;
  summary: string;
  is_open: boolean;
  resolution?: string;
  whiteboard?: string;
  component?: string;
  product?: string;
}

export interface ProductMetadata {
  name: string;
  components: Set<string>;
  versions: Set<string>;
}

const BUG_FIELDS = 'id,summary,is_open,resolution,whiteboard,component,product';
const GET_RETRIES = 2;
const RETRY_DELAY_MS = 500;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class BugzillaClient {
  constructor(
    private readonly config: BugzillaConfig,
    private readonly log: Logger,
  ) {}

  /** Products with their components and versions, for validating fields before filing. */
  async productMetadata(names: readonly string[]): Promise<Map<string, ProductMetadata>> {
    const query = names.map((name) => `names=${encodeURIComponent(name)}`).join('&');
    const result = await this.call(
      'GET',
      `/product?${query}&include_fields=name,components.name,versions.name`,
    );
    const metadata = new Map<string, ProductMetadata>();
    const products =
      isPlainObject(result.json) && Array.isArray(result.json.products) ? result.json.products : [];
    for (const product of products) {
      if (!isPlainObject(product) || typeof product.name !== 'string') continue;
      const components = Array.isArray(product.components) ? product.components : [];
      const versions = Array.isArray(product.versions) ? product.versions : [];
      metadata.set(product.name, {
        name: product.name,
        components: new Set(components.filter(isPlainObject).map((c) => String(c.name))),
        versions: new Set(versions.filter(isPlainObject).map((v) => String(v.name))),
      });
    }
    return metadata;
  }

  /** Every bug carrying this tag in its summary or (for an adopted ticket) its whiteboard. */
  async findByTag(tag: string): Promise<{ bugs: BugSummary[] } | { error: string }> {
    const bySummary = await this.call(
      'GET',
      `/bug?quicksearch=${encodeURIComponent(`ALL "[${tag}]"`)}&include_fields=${BUG_FIELDS}`,
    );
    if (!bySummary.ok) return { error: describeFailure(bySummary) };
    const byWhiteboard = await this.call(
      'GET',
      `/bug?whiteboard=${encodeURIComponent(tag)}&include_fields=${BUG_FIELDS}`,
    );
    if (!byWhiteboard.ok) return { error: describeFailure(byWhiteboard) };

    const found = new Map<number, BugSummary>();
    for (const bug of [...readBugs(bySummary.json), ...readBugs(byWhiteboard.json)]) {
      if (bug.summary.includes(`[${tag}]`) || (bug.whiteboard ?? '').includes(tag))
        found.set(bug.id, bug);
    }
    return { bugs: [...found.values()] };
  }

  /** Open bugs of one component whose summary contains `phrase` — the cross-bench duplicate check. */
  async findOpenByPhrase(
    product: string,
    component: string,
    phrase: string,
  ): Promise<{ bugs: BugSummary[] } | { error: string }> {
    const result = await this.call(
      'GET',
      `/bug?product=${encodeURIComponent(product)}&component=${encodeURIComponent(component)}` +
        `&summary=${encodeURIComponent(phrase)}&include_fields=${BUG_FIELDS}&limit=25`,
    );
    if (!result.ok) return { error: describeFailure(result) };
    return { bugs: readBugs(result.json).filter((bug) => bug.is_open) };
  }

  /** Whether a Bugzilla account exists; a create with an unknown `assigned_to` is refused. */
  async userExists(email: string): Promise<boolean> {
    const result = await this.call('GET', `/user?names=${encodeURIComponent(email)}`);
    if (!result.ok) {
      this.log.warn(`could not verify assignee ${email}: ${describeFailure(result)}`);
      return false;
    }
    const users =
      isPlainObject(result.json) && Array.isArray(result.json.users) ? result.json.users : [];
    return users
      .filter(isPlainObject)
      .some((user) => str(user.email)?.toLowerCase() === email.toLowerCase());
  }

  async createBug(fields: Record<string, unknown>): Promise<{ id: number } | { error: string }> {
    const result = await this.call('POST', '/bug', fields);
    const id =
      isPlainObject(result.json) && typeof result.json.id === 'number' ? result.json.id : undefined;
    if (!result.ok || id === undefined) return { error: describeFailure(result) };
    return { id };
  }

  async addComment(bugId: number, body: string): Promise<{ ok: true } | { error: string }> {
    const result = await this.call('POST', `/bug/${bugId}/comment`, { comment: body });
    return result.ok ? { ok: true } : { error: describeFailure(result) };
  }

  /**
   * Reopens a resolved bug with a comment. Status REOPENED (the tracker counts "fixes that didn't
   * hold"), falling back to CONFIRMED where REOPENED does not exist.
   */
  async reopen(bugId: number, comment: string): Promise<{ ok: true } | { error: string }> {
    const reopen = (status: string) =>
      this.call('PUT', `/bug/${bugId}`, { status, resolution: '', comment: { body: comment } });
    const result = await reopen('REOPENED');
    if (result.ok) return { ok: true };
    const fallback = await reopen('CONFIRMED');
    if (fallback.ok) {
      this.log.warn(
        `bug ${bugId}: REOPENED was refused (${describeFailure(result)}); reopened as CONFIRMED`,
      );
      return { ok: true };
    }
    return { error: describeFailure(result) };
  }

  /** Marks a bug RESOLVED/FIXED, recording why (the run that verified the fix). */
  async resolveFixed(bugId: number, comment: string): Promise<{ ok: true } | { error: string }> {
    const result = await this.call('PUT', `/bug/${bugId}`, {
      status: 'RESOLVED',
      resolution: 'FIXED',
      comment: { body: comment },
    });
    return result.ok ? { ok: true } : { error: describeFailure(result) };
  }

  /** Marks a bug RESOLVED/INVALID with a reason; the filer then never re-files it. */
  async resolveInvalid(bugId: number, comment: string): Promise<{ ok: true } | { error: string }> {
    const result = await this.call('PUT', `/bug/${bugId}`, {
      status: 'RESOLVED',
      resolution: 'INVALID',
      comment: { body: comment },
    });
    return result.ok ? { ok: true } : { error: describeFailure(result) };
  }

  /** Every open bug of a product, whatever its tag, so the status pass updates them all. */
  async openBugs(product: string): Promise<{ bugs: BugSummary[] } | { error: string }> {
    const result = await this.call(
      'GET',
      `/bug?product=${encodeURIComponent(product)}&resolution=---&include_fields=${BUG_FIELDS}&limit=0`,
    );
    if (!result.ok) return { error: describeFailure(result) };
    return { bugs: readBugs(result.json).filter((bug) => bug.is_open) };
  }

  /**
   * Bench-tagged bugs resolved FIXED, to reopen when the same fault returns under a shifted tag.
   */
  async fixedBenchBugs(
    product: string,
    tagPrefix: string,
  ): Promise<{ bugs: BugSummary[] } | { error: string }> {
    const result = await this.call(
      'GET',
      `/bug?product=${encodeURIComponent(product)}&resolution=FIXED&include_fields=${BUG_FIELDS}&limit=0`,
    );
    if (!result.ok) return { error: describeFailure(result) };
    const tag = new RegExp(`\\[${tagPrefix}-[0-9A-F]{6}\\]`, 'i');
    return { bugs: readBugs(result.json).filter((bug) => tag.test(bug.summary)) };
  }

  /** Every open bug of a product carrying our dedupe tag (`[<prefix>-…]`), for dedup. */
  async openBenchBugs(
    product: string,
    tagPrefix: string,
  ): Promise<{ bugs: BugSummary[] } | { error: string }> {
    const result = await this.call(
      'GET',
      `/bug?product=${encodeURIComponent(product)}&resolution=---&include_fields=${BUG_FIELDS}&limit=0`,
    );
    if (!result.ok) return { error: describeFailure(result) };
    const tag = new RegExp(`\\[${tagPrefix}-[0-9A-F]{6}\\]`, 'i');
    return { bugs: readBugs(result.json).filter((bug) => bug.is_open && tag.test(bug.summary)) };
  }

  /**
   * Bench-tagged bugs a human closed as not-a-defect, so the dry-run preview shows `judged-skip`.
   */
  async judgedBenchBugs(
    product: string,
    tagPrefix: string,
  ): Promise<{ bugs: BugSummary[] } | { error: string }> {
    const resolutions = [...JUDGED_NOT_A_DEFECT].map((r) => `resolution=${r}`).join('&');
    const result = await this.call(
      'GET',
      `/bug?product=${encodeURIComponent(product)}&${resolutions}&include_fields=${BUG_FIELDS}&limit=0`,
    );
    if (!result.ok) return { error: describeFailure(result) };
    const tag = new RegExp(`${tagPrefix}-[0-9A-F]{6}`, 'i');
    return {
      bugs: readBugs(result.json).filter(
        (bug) => tag.test(bug.summary) || tag.test(bug.whiteboard ?? ''),
      ),
    };
  }

  /** Appends the dedupe tag to an adopted ticket's whiteboard so later runs find it by tag. */
  async appendWhiteboard(bugId: number, existing: string, tag: string): Promise<void> {
    if (existing.includes(tag)) return;
    const whiteboard = `${existing} [${tag}]`.trim();
    const result = await this.call('PUT', `/bug/${bugId}`, { whiteboard });
    if (!result.ok) this.log.warn(`could not tag bug ${bugId}: ${describeFailure(result)}`);
  }

  async attach(
    bugId: number,
    attachment: { fileName: string; summary: string; body: string },
  ): Promise<void> {
    const result = await this.call('POST', `/bug/${bugId}/attachment`, {
      ids: [bugId],
      data: Buffer.from(attachment.body, 'utf8').toString('base64'),
      file_name: attachment.fileName,
      summary: attachment.summary,
      content_type: 'text/plain',
    });
    if (!result.ok)
      this.log.warn(
        `bug ${bugId} filed, but the evidence attachment failed: ${describeFailure(result)}`,
      );
  }

  /** A bug's first comment (its description) — used to read a systemic ticket's affected-endpoint list. */
  async firstComment(bugId: number): Promise<string | undefined> {
    const result = await this.call('GET', `/bug/${bugId}/comment`);
    if (!result.ok || !result.json) return undefined;
    const bugs = (result.json as { bugs?: Record<string, { comments?: { text?: string }[] }> })
      .bugs;
    return bugs?.[String(bugId)]?.comments?.[0]?.text;
  }

  /** Every comment body on a bug, oldest first (used to count prior reopens). */
  async commentTexts(bugId: number): Promise<string[]> {
    const result = await this.call('GET', `/bug/${bugId}/comment`);
    if (!result.ok || !result.json) return [];
    const bugs = (result.json as { bugs?: Record<string, { comments?: { text?: string }[] }> })
      .bugs;
    return (bugs?.[String(bugId)]?.comments ?? [])
      .map((c) => c.text)
      .filter((t): t is string => Boolean(t));
  }

  /** Existing attachment file names on a bug, so proof is never uploaded twice on a re-run. */
  async attachmentNames(bugId: number): Promise<Set<string>> {
    const result = await this.call('GET', `/bug/${bugId}/attachment?include_fields=file_name`);
    if (!result.ok || !result.json) return new Set();
    const bugs = (result.json as { bugs?: Record<string, { file_name?: string }[]> }).bugs ?? {};
    const list = bugs[String(bugId)] ?? [];
    return new Set(list.map((a) => a.file_name).filter((n): n is string => Boolean(n)));
  }

  /** Uploads a screenshot or video to a bug; a failure only warns. Returns whether it attached. */
  async attachFile(
    bugId: number,
    file: { fileName: string; summary: string; data: Buffer; contentType: string },
  ): Promise<boolean> {
    const result = await this.call('POST', `/bug/${bugId}/attachment`, {
      ids: [bugId],
      data: file.data.toString('base64'),
      file_name: file.fileName,
      summary: file.summary,
      content_type: file.contentType,
    });
    if (!result.ok) {
      this.log.warn(
        `bug ${bugId} filed, but proof "${file.fileName}" did not attach ` +
          `(${Math.round(file.data.length / 1024)} KB): ${describeFailure(result)} ` +
          `— check Bugzilla's max attachment size.`,
      );
      return false;
    }
    return true;
  }

  private async call(
    method: 'GET' | 'POST' | 'PUT',
    pathAndQuery: string,
    body?: unknown,
  ): Promise<CallResult> {
    const attempts = method === 'GET' ? GET_RETRIES + 1 : 1;
    let last: CallResult = { ok: false, error: 'no attempt made' };
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      last = await this.send(method, pathAndQuery, body);
      // Only transport failures are retried; an application error would fail again identically.
      if (last.ok || !last.error) return last;
      if (attempt < attempts) await delay(RETRY_DELAY_MS * attempt);
    }
    return last;
  }

  private async send(method: string, pathAndQuery: string, body?: unknown): Promise<CallResult> {
    const separator = pathAndQuery.includes('?') ? '&' : '?';
    const url = `${this.config.url}${pathAndQuery}${separator}api_key=${encodeURIComponent(this.config.apiKey)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text().catch(() => '');
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      // Bugzilla answers application errors with HTTP 200 and {"error": true}.
      const failed = !response.ok || (isPlainObject(json) && json.error === true);
      // The URL carries the API key — log the path only.
      this.log.debug(
        `${method} ${pathAndQuery.split('?')[0]} -> ${response.status}${failed ? ' (error)' : ''}`,
      );
      return failed
        ? { ok: false, status: response.status, json, text: text.slice(0, 300) }
        : { ok: true, status: response.status, json, text };
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'AbortError'
          ? `no response within ${this.config.timeoutMs / 1000}s`
          : error instanceof Error
            ? error.message
            : String(error);
      return { ok: false, error: reason };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Reads only values of the expected type — a surprising payload must not become "[object Object]". */
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

function readBugs(json: unknown): BugSummary[] {
  if (!isPlainObject(json) || !Array.isArray(json.bugs)) return [];
  return json.bugs.filter(isPlainObject).map((bug) => ({
    id: typeof bug.id === 'number' ? bug.id : Number.NaN,
    summary: str(bug.summary) ?? '',
    is_open: bug.is_open === true,
    resolution: str(bug.resolution),
    whiteboard: str(bug.whiteboard),
    component: str(bug.component),
    product: str(bug.product),
  }));
}

/** Bugzilla's own message is the useful half; the rest of the body is a Perl stack trace. */
export function describeFailure(result: CallResult): string {
  if (result.error) return result.error;
  const message = isPlainObject(result.json) ? str(result.json.message) : undefined;
  return (message ?? result.text ?? `HTTP ${result.status ?? '?'}`).split('\n')[0]!.slice(0, 300);
}
