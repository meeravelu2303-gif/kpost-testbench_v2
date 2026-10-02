# Payload completeness audit

**GENERATED — do not edit.** Written by `tests/framework/payload-audit.spec.ts`.

**0** endpoints that run on live (`productionSafe`) omit a field present in
the documented request *example* — the actual false-bug queue, because only a live-running
endpoint auto-files a bug. A further **19** example-missing endpoints are GATED writes (payload supplied by their lifecycle spec with
runtime ids — not fuzzed on live), and **30** omit only *schema-declared* fields with no example (mostly the admin entity DTO — the
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
| `POST /v2/common/validateOTP/` (`common-validate-otp`) | sendDate |
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
| `POST /adminTierAttribute/getAttribute` (`admin-workplace-tier-attribute-get`) | companyId, attributeName, abbreviation, code |
| `POST /location/getReportingLocationName` (`admin-workplace-location-reporting-name`) | attributeId, variableId, workPlaceLocation, reportingWorkplaceLocation, reportingWorkplaceLocationId, locationName, pincode, state, city, area, addressLine1, addressLine2, abbreviation, code, companyId, countryId, countryName |
| `POST /workplaceHierarchy/save` (`admin-workplace-hierarchy-save`) | id, parentAttributeId, parentVariableId, reportingAttributeId, reportingVariableId, reportingParentAttributeId, reportingParentVariableId, workplaceJson, reportingJson, abbreviation, code |
| `POST /workplaceHierarchy/update` (`admin-workplace-hierarchy-update`) | parentAttributeId, parentVariableId, reportingAttributeId, reportingVariableId, reportingParentAttributeId, reportingParentVariableId, workplaceJson, reportingJson, abbreviation, code |
| `POST /workplaceHierarchy/delete` (`admin-workplace-hierarchy-delete`) | attributeId, variableId, parentAttributeId, parentVariableId, reportingAttributeId, reportingVariableId, reportingParentAttributeId, reportingParentVariableId, workplaceJson, reportingJson, abbreviation, code |
| `POST /hrSetUpTierAttribute/getAttribute` (`admin-hr-tier-attribute-get`) | companyId, attributeName, abbreviation, code |
| `POST /attribute/getAttributeByCompanyId` (`admin-attribute-by-company`) | id, attributeName |
| `POST /attribute/getAttribute` (`admin-attribute-get`) | companyId, attributeName |
| `POST /attribute/delete` (`admin-attribute-delete`) | companyId, attributeName |
| `POST /variable/getVariable` (`admin-variable-list`) | id, attributeId, variableName, parentAttributeId, abbreviation, code |
| `POST /variable/update` (`admin-variable-update`) | parentVariableId, parentAttributeId, abbreviation, code |
| `POST /variable/delete` (`admin-variable-delete`) | attributeId, companyId, variableName, parentVariableId, parentAttributeId, abbreviation, code |
| `POST /hrTier/getAttributeByCompanyId` (`admin-hr-tier-extra-by-company`) | id, attributeName, abbreviation, code |
| `POST /hrTier/getAttribute` (`admin-hr-tier-extra-get`) | companyId, attributeName, abbreviation, code |
| `POST /hrTier/update` (`admin-hr-tier-extra-update`) | abbreviation, code |
| `POST /hrTier/delete` (`admin-hr-tier-extra-delete`) | companyId, attributeName, abbreviation, code |
| `POST /hrVariable/getVariable` (`admin-hr-variable-extra-list`) | id, attributeId, variableName, parentAttributeId, abbreviation, code |
| `POST /hrVariable/save` (`admin-hr-variable-extra-save`) | id, parentAttributeId, abbreviation, code |
| `POST /hrVariable/update` (`admin-hr-variable-extra-update`) | parentVariableId, parentAttributeId, abbreviation, code |
| `POST /hrVariable/delete` (`admin-hr-variable-extra-delete`) | attributeId, companyId, variableName, parentVariableId, parentAttributeId, abbreviation, code |
| `POST /department/getDepartmentByCompanyId` (`admin-department-by-company`) | id, departmentName, abbreviation, code |
| `POST /department/update` (`admin-department-update`) | abbreviation, code |
| `POST /department/delete` (`admin-department-delete`) | companyId, departmentName, abbreviation, code |
| `POST /department/abbreviationAndCodeCreation` (`admin-department-abbreviation-code`) | id, abbreviation, code |
| `POST /designation/getDesignationByCompanyIdAndDepartmentId` (`admin-designation-by-company-department`) | id, parentDesignationId, designationName, abbreviation, code, departmentIdList |
| `POST /designation/update` (`admin-designation-update`) | parentDesignationId, abbreviation, code, departmentIdList |
| `POST /designation/delete` (`admin-designation-delete`) | departmentId, companyId, parentDesignationId, designationName, abbreviation, code, departmentIdList |
| `POST /designation/abbreviationAndCodeCreation` (`admin-designation-abbreviation-code`) | id, departmentId, parentDesignationId, abbreviation, code, departmentIdList |
| `POST /productEmployeeMapping/getMappedEmployeeByCompanyIdAndProductId` (`admin-product-employee-mapping-get`) | id, employeeId, rolePostingId, kpostId |
| `POST /productEmployeeMapping/getKpostIDsByCompanyIdAndProductId` (`admin-product-employee-mapping-kpost-ids`) | id, employeeId, rolePostingId, kpostId |

