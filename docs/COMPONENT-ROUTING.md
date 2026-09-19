# Component routing — every endpoint → its Bugzilla component

**GENERATED — do not edit.** Written by `tests/framework/component-routing.spec.ts`
(`npm run test:framework`). It resolves `componentFor` for every registered endpoint and checks
each target exists in the live product, so tickets can never route to a non-existent component.

## KPost Admin (38 endpoints)

| Component | Endpoints |
| --------- | --------: |
| Role Postings | 8 |
| Workplace Locations | 6 |
| Workplace Tier — Variables (Nodes) | 5 |
| HR Set-Up Tier — Variables (Nodes) | 5 |
| Workplace Tier — Attributes (Levels) | 4 |
| HR Set-Up Tier — Levels | 4 |
| Employee Master Data | 4 |
| Workplace Hierarchy Links | 1 |
| Country & Address Reference Data | 1 |

### KPost Admin — endpoint → component

**Country & Address Reference Data**

- `admin-country-address-by-pincode`

**Employee Master Data**

- `admin-employee-delete`
- `admin-employee-details`
- `admin-employee-save`
- `admin-employee-update`

**HR Set-Up Tier — Levels**

- `admin-hr-tier-attribute-by-company`
- `admin-hr-tier-attribute-delete`
- `admin-hr-tier-attribute-save`
- `admin-hr-tier-attribute-update`

**HR Set-Up Tier — Variables (Nodes)**

- `admin-hr-tier-variable-delete`
- `admin-hr-tier-variable-list`
- `admin-hr-tier-variable-reporting-hierarchy`
- `admin-hr-tier-variable-save`
- `admin-hr-tier-variable-update`

**Role Postings**

- `admin-role-posting-by-company`
- `admin-role-posting-by-company-and-employee`
- `admin-role-posting-delete`
- `admin-role-posting-employees`
- `admin-role-posting-save`
- `admin-role-posting-suspend-terminate`
- `admin-role-posting-suspended-list`
- `admin-role-posting-update`

**Workplace Hierarchy Links**

- `admin-workplace-hierarchy`

**Workplace Locations**

- `admin-workplace-location-all`
- `admin-workplace-location-by-id`
- `admin-workplace-location-delete`
- `admin-workplace-location-get`
- `admin-workplace-location-save`
- `admin-workplace-location-update`

**Workplace Tier — Attributes (Levels)**

- `admin-workplace-tier-attribute-by-company`
- `admin-workplace-tier-attribute-delete`
- `admin-workplace-tier-attribute-save`
- `admin-workplace-tier-attribute-update`

**Workplace Tier — Variables (Nodes)**

- `admin-workplace-tier-variable-delete`
- `admin-workplace-tier-variable-list`
- `admin-workplace-tier-variable-reporting-hierarchy`
- `admin-workplace-tier-variable-save`
- `admin-workplace-tier-variable-update`

## KMail API (70 endpoints)

| Component | Endpoints |
| --------- | --------: |
| KMail Settings - Signature & Letterhead | 21 |
| Mailbox, Folders & Follow-up | 20 |
| Read Mail & Attachments | 13 |
| Draft Mail | 7 |
| Contacts & Sync | 4 |
| Sent Mail - Compose & Send | 4 |
| Translation | 1 |

### KMail API — endpoint → component

**Contacts & Sync**

- `kmail-frequent-contact`
- `kmail-known-postbox-contacts`
- `kmail-misc-contacts`
- `kmail-postbox-contacts`

**Draft Mail**

- `kmail-all-drafts`
- `kmail-draft-contacts`
- `kmail-draft-content`
- `kmail-draft-delete`
- `kmail-draft-multipart`
- `kmail-draft-save`
- `kmail-drafts-for-contact`

**KMail Settings - Signature & Letterhead**

- `kmail-all-letterhead`
- `kmail-count-days-limit`
- `kmail-count-days-limit-update`
- `kmail-delete-instant-reply`
- `kmail-delete-letterhead`
- `kmail-delete-saluation`
- `kmail-digital-signature`
- `kmail-instant-reply`
- `kmail-letterhead`
- `kmail-letterhead-template`
- `kmail-mail-signature`
- `kmail-save-saluation`
- `kmail-set-instant-reply`
- `kmail-set-letterhead`
- `kmail-sig-company`
- `kmail-sig-full`
- `kmail-sig-graphics`
- `kmail-sig-personal`
- `kmail-sig-social`
- `kmail-sig-style`
- `kmail-sig-template`

**Mailbox, Folders & Follow-up**

- `kmail-add-od-contact`
- `kmail-all-mail-count`
- `kmail-clear-all-status`
- `kmail-clear-status`
- `kmail-convert-pdf`
- `kmail-credentials`
- `kmail-dashboard`
- `kmail-delete`
- `kmail-delete-od-contact`
- `kmail-edit-od-contact`
- `kmail-important-mails`
- `kmail-reply-not-received`
- `kmail-reply-not-req-receiver`
- `kmail-reply-not-req-sender`
- `kmail-reply-not-sent`
- `kmail-sent-not-opened`
- `kmail-set-important`
- `kmail-status-total-count`
- `kmail-status-with-count`
- `kmail-unopened-count`

**Read Mail & Attachments**

- `kmail-copies-info`
- `kmail-details-by-id`
- `kmail-download-attachment`
- `kmail-download-od-attachment`
- `kmail-download-thumbnail`
- `kmail-group-read-status`
- `kmail-mail-content`
- `kmail-media-streaming`
- `kmail-other-domain-mails`
- `kmail-reference-content`
- `kmail-saluations`
- `kmail-selected-contact-mails`
- `kmail-subjects`

**Sent Mail - Compose & Send**

- `kmail-bulk-dashboard`
- `kmail-bulk-status`
- `kmail-post-bulk`
- `kmail-post-mail`

**Translation**

- `kmail-translation`

## KPost API (233 endpoints)

| Component | Endpoints |
| --------- | --------: |
| User Profile V2 | 45 |
| Katchup Messaging V2 | 36 |
| Common Reference Data & Utilities V2 | 20 |
| Kall (Voice/Video) V2 - current | 20 |
| Company Administration | 19 |
| Authentication V2 | 18 |
| KWord Documents | 18 |
| Contacts Directory V2 | 16 |
| Kdiary - Schedules, Events & Reports | 14 |
| Groups V2 | 11 |
| General Settings | 7 |
| Integration - AWS S3 Pre-signed URLs | 4 |
| Dashboard V2 | 3 |
| Authentication - Medium & Large Enterprise | 2 |

### KPost API — endpoint → component

**Authentication - Medium & Large Enterprise**

- `signup-login-admin-registration`
- `signup-login-admin-user-login`

**Authentication V2**

- `common-forgot-password-otp`
- `common-forgot-password-update`
- `common-send-otp`
- `common-send-otp-to-mail`
- `common-validate-mail-otp`
- `common-validate-otp`
- `signup-login-active-session`
- `signup-login-fetch-user-details`
- `signup-login-generate-jwt`
- `signup-login-kpost-id-exist`
- `signup-login-kpost-id-suggestions`
- `signup-login-login-history`
- `signup-login-logout-all-devices`
- `signup-login-set-access-code`
- `signup-login-signup`
- `signup-login-signup-get`
- `signup-login-user-login`
- `signup-login-user-logout`

**Common Reference Data & Utilities V2**

- `common-cities-by-region`
- `common-countries`
- `common-designation`
- `common-domain`
- `common-flutter-app-version`
- `common-generate-domain-and-unique-name`
- `common-kpost-id-using-module`
- `common-languages`
- `common-mobile-no-exist`
- `common-mobile-no-exist-in-company`
- `common-ms-status`
- `common-pincode`
- `common-postal-pincode`
- `common-save-enquiry-details`
- `common-save-unsubscriber-details`
- `common-states`
- `common-total-count-by-date`
- `common-unique-name-exist`
- `common-update-flutter-app-version`
- `common-user-details-by-mobile`

**Company Administration**

- `admin-adding-user-by-admin`
- `admin-bank-and-company-details`
- `admin-create-remove-backup-admin`
- `admin-display-name-suggestion`
- `admin-hold-or-release`
- `admin-kpostid-designation-suggestion`
- `admin-reset-password`
- `admin-terminate-user`
- `admin-update-bank-account`
- `admin-update-company-details`
- `admin-update-role`
- `admin-user-management-details`
- `common-company-details`
- `common-company-details-by-admin`
- `common-company-details-by-mobile-and-product`
- `common-company-name-exist`
- `common-download-company-logo`
- `common-remove-company-logo`
- `common-update-company-logo`

**Contacts Directory V2**

- `contacts-add`
- `contacts-add-multiple`
- `contacts-add-reference`
- `contacts-block`
- `contacts-block-multiple`
- `contacts-blocked`
- `contacts-delete`
- `contacts-global-search`
- `contacts-import-phone`
- `contacts-imported-phone`
- `contacts-my-contacts`
- `contacts-my-groups`
- `contacts-my-unknown-contacts`
- `contacts-my-unknown-groups`
- `contacts-search-details`
- `contacts-update-invite`

**Dashboard V2**

- `dashboard-home-msgs`
- `dashboard-home-new-msgs`
- `dashboard-katchup-msg`

**General Settings**

- `settings-change-theme`
- `settings-font`
- `settings-get-notifications`
- `settings-get-personalize`
- `settings-kall-notification`
- `settings-katchup-notification`
- `settings-kmail-notification`

**Groups V2**

- `group-add-user`
- `group-admin-access`
- `group-create`
- `group-delete`
- `group-download-full-image`
- `group-download-image`
- `group-edit-name`
- `group-leave`
- `group-remove-image`
- `group-remove-member`
- `group-update-image`

**Integration - AWS S3 Pre-signed URLs**

- `aws-check-attachment`
- `aws-delete-attachment`
- `aws-generate-presigned`
- `aws-katchup-presigned`

**KWord Documents**

- `kos-access-activity`
- `kos-ai-assist`
- `kos-ai-chat`
- `kos-ai-messages`
- `kos-ai-sessions`
- `kos-convert-to-kad`
- `kos-create-doc`
- `kos-delete-doc`
- `kos-delete-heading`
- `kos-exit-doc`
- `kos-get-document`
- `kos-join-doc`
- `kos-list-documents`
- `kos-presence`
- `kos-revisions`
- `kos-save-content`
- `kos-share-doc`
- `kos-update-doc`

**Kall (Voice/Video) V2 - current**

- `kall-clear-by-ids`
- `kall-clear-history`
- `kall-contact-info`
- `kall-dashboard`
- `kall-end-individual`
- `kall-end-kool`
- `kall-fetch-scheduled-repeat`
- `kall-frequent-contacts`
- `kall-get-status`
- `kall-get-status-by-id`
- `kall-info`
- `kall-initiate`
- `kall-join-schedule`
- `kall-modify-members`
- `kall-reschedule`
- `kall-scheduled`
- `kall-scheduled-repeat`
- `kall-today-kool`
- `kall-update-sender-receiver-status`
- `kall-update-status`

**Katchup Messaging V2**

- `katchup-all-report-msg`
- `katchup-bulk-message-info`
- `katchup-conversation`
- `katchup-delete-message`
- `katchup-download`
- `katchup-download-attachment`
- `katchup-download-from-s3`
- `katchup-download-thumbnail`
- `katchup-filter-message`
- `katchup-forward-backtrack`
- `katchup-forward-message`
- `katchup-forward-message-new`
- `katchup-forward-multiple`
- `katchup-frequent-contacts`
- `katchup-generate-thumbnail`
- `katchup-mark-important`
- `katchup-media-streaming`
- `katchup-message-count`
- `katchup-messages-by-reference`
- `katchup-messages-subject`
- `katchup-read-status-group`
- `katchup-recall-message`
- `katchup-reference-details`
- `katchup-report-abuse`
- `katchup-save-messages`
- `katchup-search-message`
- `katchup-search-subject`
- `katchup-send-bulk`
- `katchup-send-bulk-multipart`
- `katchup-send-forward-selected-attachment`
- `katchup-send-message`
- `katchup-send-multipart`
- `katchup-shared-message-details`
- `katchup-shared-message-info`
- `katchup-unopened-count`
- `katchup-unopened-total-count`

**Kdiary - Schedules, Events & Reports**

- `kdiary-add-participants`
- `kdiary-create-event`
- `kdiary-create-schedule`
- `kdiary-delete-event`
- `kdiary-edit-report`
- `kdiary-edit-schedule-event`
- `kdiary-get-event-date`
- `kdiary-get-event-selected-date`
- `kdiary-get-events`
- `kdiary-save-report`
- `kdiary-today-report`
- `kdiary-today-schedules`
- `kdiary-update-event`
- `kdiary-update-remarks`

**User Profile V2**

- `profile-advanced-search`
- `profile-auto-search`
- `profile-change-password`
- `profile-convert-base64`
- `profile-deactivate-account`
- `profile-delete-college`
- `profile-delete-experience`
- `profile-delete-school`
- `profile-delete-university`
- `profile-digital-card`
- `profile-download-cover`
- `profile-download-full-image`
- `profile-download-image`
- `profile-fetch-user-details`
- `profile-forgot-password-or-kpostid`
- `profile-get-languages`
- `profile-get-signature`
- `profile-is-device-primary`
- `profile-remove-cover`
- `profile-remove-image`
- `profile-save-college`
- `profile-save-experience`
- `profile-save-other-activity`
- `profile-save-school`
- `profile-save-university`
- `profile-send-deactivation-otp`
- `profile-send-device-otp`
- `profile-send-primary-device-otp`
- `profile-set-device-primary`
- `profile-set-device-secondary`
- `profile-share-user-details`
- `profile-update-about`
- `profile-update-basic`
- `profile-update-contact`
- `profile-update-designation`
- `profile-update-device-primary`
- `profile-update-device-secondary`
- `profile-update-image`
- `profile-update-privacy`
- `profile-update-signature`
- `profile-upload-attachments`
- `profile-upload-cover`
- `profile-upload-image-s3`
- `profile-user-basic-by-kpostid`
- `profile-user-profile-by-kpostid`

