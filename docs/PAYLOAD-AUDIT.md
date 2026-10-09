# Payload completeness audit

**GENERATED — do not edit.** Written by `tests/framework/payload-audit.spec.ts`.

**0** endpoints that run on live (`productionSafe`) omit a field present in
the documented request *example* — the actual false-bug queue, because only a live-running
endpoint auto-files a bug. A further **18** example-missing endpoints are GATED writes (payload supplied by their lifecycle spec with
runtime ids — not fuzzed on live), and **21** omit only *schema-declared* fields with no example (mostly the admin entity DTO — the
springdoc schema lists every optional field; the measured frontend sends a subset).

## A — Runs on live AND omits an example field (the false-bug queue)

_None — every live-running endpoint sends every documented-example field._

## B — Not run on the default live run (gated writes + needs-id reads) omitting an example field

These never execute on the default live run (the production guard blocks a destructive
non-`productionSafe` endpoint, and a needs-id read has no live-safe input), so they cannot
auto-file a bug. Their real payload — with runtime ids — is built by the endpoint’s lifecycle
spec (`*_LIFECYCLE`), not by the static factory audited here.

| Endpoint | Fields in the example but not sent |
| -------- | ---------------------------------- |
| `POST /v2/katchup/sendMessageForForwardSelectedAttachment` (`katchup-send-forward-selected-attachment`) | actualMessage, attachmentCaption, messageTime, serverTime, referenceMessage, groupFlag, forwardReceiverList, groupForwardList, groupmemberList, sharedMessageDetails, selectedMembers, secretMessageExpireTime, isVanished, sharedType, temporaryMsgID, uuid, isHtml, isVoiceMessage, referenceMessageIDList, referenceMessageList |
| `POST /v2/katchup/forwardKatchupMessageNew` (`katchup-forward-message-new`) | attachmentCaption, status, sessionID, referenceMessage, groupFlag, forwardReceiverList, groupForwardList, groupmemberList, sharedMessageDetails, sharedType, temporaryMsgID, uuid, isVoiceMessage |
| `POST /v2/katchup/forwardKatchupMultipleMsgs` (`katchup-forward-multiple`) | forwardMessageIDList, attachmentCaption, uuid, messageType, sessionID, actualMessage |
| `POST /v2/admin/updateCompanyDetails` (`admin-update-company-details`) | companyName, address1, address2, panNumber, gstNumber |
| `POST /v2/admin/updateBankAccountDetails` (`admin-update-bank-account`) | accountNumber, accountHolderName, ifscCode, bankName, branch |
| `POST /redbus/blockTicket/{kpostId}` (`kbooking-block-ticket`) | availableTripId, boardingPointId, destination, source |
| `POST /v2/profile/updateContactInformation/` (`profile-update-contact`) | addressLine2, alternateMobileno, landLineNumber |
| `POST /admin/resetPassword/` (`admin-reset-password`) | companyID, userType |
| `POST /v2/common/validateMailOTP/` (`common-validate-mail-otp`) | sendDate |
| `POST /admin/holdOrRelease/` (`admin-hold-or-release`) | activeStatus |
| `POST /v2/admin/updateRole` (`admin-update-role`) | role |
| `POST /v2/katchup/getMessagesByReferenceMessageList` (`katchup-messages-by-reference`) | messageType |
| `POST /v2/katchup/sendBulkKatchupMsg` (`katchup-send-bulk`) | mapDetails |
| `POST /v2/katchup/recallMessage/` (`katchup-recall-message`) | status |
| `POST /testkmail/v2/readMail/draftMailContent` (`kmail-draft-content`) | senderUniqueMailID |
| `POST /testkmail/v2/draft/deleteDraftMail/` (`kmail-draft-delete`) | kmailSendDate |
| `POST /testkmail/v2/common/editOtherDomainContactsDetails/` (`kmail-edit-od-contact`) | referenceName |
| `POST /testkmail/v2/readMail/downloadODAttachment` (`kmail-download-od-attachment`) | targetFileName |

## C — Missing from the schema only (no example — review, usually correct)

| Endpoint | Schema-only fields not sent |
| -------- | --------------------------- |
| `POST /adminTierAttribute/getAttributeByCompanyId` (`admin-workplace-tier-attribute-by-company`) | companyId |
| `POST /adminTierAttribute/update` (`admin-workplace-tier-attribute-update`) | companyId |
| `POST /adminTierVariable/getAdminTierVariable` (`admin-workplace-tier-variable-list`) | companyId |
| `POST /adminTierVariable/update` (`admin-workplace-tier-variable-update`) | companyId |
| `POST /location/getAllLocation` (`admin-workplace-location-all`) | companyId |
| `POST /location/getLocation` (`admin-workplace-location-get`) | companyId |
| `POST /location/update` (`admin-workplace-location-update`) | companyId |
| `POST /workplaceHierarchy/getWorkPlaceHierarchy` (`admin-workplace-hierarchy`) | companyId |
| `POST /hrSetUpTierAttribute/getAttributeByCompanyId` (`admin-hr-tier-attribute-by-company`) | companyId |
| `POST /hrSetUpTierAttribute/update` (`admin-hr-tier-attribute-update`) | companyId |
| `POST /hrSetUpTierVariable/getHrSetUpTierVariable` (`admin-hr-tier-variable-list`) | companyId |
| `POST /hrSetUpTierVariable/update` (`admin-hr-tier-variable-update`) | companyId |
| `POST /rolePosting/getRolePostingByCompanyId` (`admin-role-posting-by-company`) | companyId |
| `POST /rolePosting/getEmployeeByCompanyId` (`admin-role-posting-employees`) | companyId |
| `POST /rolePosting/getSuspendOrTerminateEmployee` (`admin-role-posting-suspended-list`) | companyId |
| `POST /rolePosting/getRolePostingByCompanyIdAndEmployeeId` (`admin-role-posting-by-company-and-employee`) | companyId |
| `POST /rolePosting/save` (`admin-role-posting-save`) | companyId, employeeId, hrVariableId, locationId |
| `POST /rolePosting/suspendOrTerminateEmployee` (`admin-role-posting-suspend-terminate`) | companyId |
| `POST /employeeDetails/getEmployeeDetails` (`admin-employee-details`) | companyId |
| `POST /employeeDetails/save` (`admin-employee-save`) | companyId |
| `POST /employeeDetails/update` (`admin-employee-update`) | companyId |

