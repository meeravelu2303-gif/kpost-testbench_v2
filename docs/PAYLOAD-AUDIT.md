# Payload completeness audit

**GENERATED — do not edit.** Written by `tests/framework/payload-audit.spec.ts`.

**0** endpoints that run on live (`productionSafe`) omit a field present in
the documented request *example* — the actual false-bug queue, because only a live-running
endpoint auto-files a bug. A further **18** example-missing endpoints are GATED writes (payload supplied by their lifecycle spec with
runtime ids — not fuzzed on live), and **31** omit only *schema-declared* fields with no example (mostly the admin entity DTO — the
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
| `POST /v2/katchup/forwardKatchupMessage/` (`katchup-forward-message`) | attachmentCaption, status, sessionID, referenceMessage, groupFlag, forwardReceiverList, groupForwardList, groupmemberList, sharedMessageDetails, sharedType, temporaryMsgID |
| `POST /v2/katchup/forwardKatchupMultipleMsgs` (`katchup-forward-multiple`) | forwardMessageIDList, attachmentCaption, uuid, messageType, sessionID, actualMessage |
| `POST /v2/admin/updateCompanyDetails` (`admin-update-company-details`) | companyName, address1, address2, panNumber, gstNumber |
| `POST /v2/admin/updateBankAccountDetails` (`admin-update-bank-account`) | accountNumber, accountHolderName, ifscCode, bankName, branch |
| `POST /v2/profile/updateContactInformation/` (`profile-update-contact`) | addressLine2, alternateMobileno, landLineNumber |
| `POST /admin/resetPassword/` (`admin-reset-password`) | companyID, userType |
| `POST /v2/common/saveEnquiryDetails` (`common-save-enquiry-details`) | timeToContact |
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
| `POST /adminTierAttribute/getAttributeByCompanyId` (`admin-workplace-tier-attribute-by-company`) | id, attributeName, abbreviation, code |
| `POST /adminTierAttribute/update` (`admin-workplace-tier-attribute-update`) | abbreviation, code |
| `POST /adminTierAttribute/delete` (`admin-workplace-tier-attribute-delete`) | companyId, attributeName, abbreviation, code |
| `POST /adminTierVariable/getAdminTierVariable` (`admin-workplace-tier-variable-list`) | id, attributeId, variableName, parentAttributeId, reportingJson, reportingAttributeId, reportingVariableId, abbreviation, code |
| `POST /adminTierVariable/update` (`admin-workplace-tier-variable-update`) | parentVariableId, parentAttributeId, reportingJson, reportingAttributeId, reportingVariableId, abbreviation, code |
| `POST /adminTierVariable/delete` (`admin-workplace-tier-variable-delete`) | attributeId, companyId, variableName, parentVariableId, parentAttributeId, reportingJson, reportingAttributeId, reportingVariableId, abbreviation, code |
| `POST /adminTierVariable/getAllReportingVariableHierarchy` (`admin-workplace-tier-variable-reporting-hierarchy`) | attributeId, companyId, variableName, parentVariableId, parentAttributeId, reportingJson, reportingAttributeId, reportingVariableId, abbreviation, code |
| `POST /location/getAllLocation` (`admin-workplace-location-all`) | id, attributeId, variableId, workPlaceLocation, reportingWorkplaceLocation, reportingWorkplaceLocationId, locationName, pincode, state, city, area, addressLine1, addressLine2, abbreviation, code, countryId, countryName |
| `POST /location/getLocation` (`admin-workplace-location-get`) | id, workPlaceLocation, reportingWorkplaceLocation, reportingWorkplaceLocationId, locationName, pincode, state, city, area, addressLine1, addressLine2, abbreviation, code, countryId, countryName |
| `POST /location/getLocationById` (`admin-workplace-location-by-id`) | attributeId, variableId, workPlaceLocation, reportingWorkplaceLocation, reportingWorkplaceLocationId, locationName, pincode, state, city, area, addressLine1, addressLine2, abbreviation, code, companyId, countryId, countryName |
| `POST /location/update` (`admin-workplace-location-update`) | attributeId, variableId, workPlaceLocation, reportingWorkplaceLocation, reportingWorkplaceLocationId, pincode, state, city, area, addressLine1, addressLine2, abbreviation, code, countryId, countryName |
| `POST /location/delete` (`admin-workplace-location-delete`) | attributeId, variableId, workPlaceLocation, reportingWorkplaceLocation, reportingWorkplaceLocationId, locationName, pincode, state, city, area, addressLine1, addressLine2, abbreviation, code, companyId, countryId, countryName |
| `POST /workplaceHierarchy/getWorkPlaceHierarchy` (`admin-workplace-hierarchy`) | id, attributeId, variableId, reportingAttributeId, reportingVariableId, reportingParentAttributeId, reportingParentVariableId, workplaceJson, reportingJson, abbreviation, code |
| `POST /hrSetUpTierAttribute/getAttributeByCompanyId` (`admin-hr-tier-attribute-by-company`) | id, attributeName, abbreviation, code |
| `POST /hrSetUpTierAttribute/update` (`admin-hr-tier-attribute-update`) | abbreviation, code |
| `POST /hrSetUpTierAttribute/delete` (`admin-hr-tier-attribute-delete`) | companyId, attributeName, abbreviation, code |
| `POST /hrSetUpTierVariable/getHrSetUpTierVariable` (`admin-hr-tier-variable-list`) | id, attributeId, variableName, parentAttributeId, reportingJson, reportingAttributeId, reportingVariableId, abbreviation, code |
| `POST /hrSetUpTierVariable/getAllReportingHrTierVariableHierarchy` (`admin-hr-tier-variable-reporting-hierarchy`) | attributeId, companyId, variableName, parentVariableId, parentAttributeId, reportingJson, reportingAttributeId, reportingVariableId, abbreviation, code |
| `POST /hrSetUpTierVariable/update` (`admin-hr-tier-variable-update`) | parentVariableId, parentAttributeId, reportingJson, reportingAttributeId, reportingVariableId, abbreviation, code |
| `POST /hrSetUpTierVariable/delete` (`admin-hr-tier-variable-delete`) | attributeId, companyId, variableName, parentVariableId, parentAttributeId, reportingJson, reportingAttributeId, reportingVariableId, abbreviation, code |
| `POST /rolePosting/getRolePostingByCompanyId` (`admin-role-posting-by-company`) | adminKsmaccID, rolePostingId, lastWorkplaceTierId, lastWorkplaceVariableId, workplaceJson, workplaceLocationId, workplaceLocaID, lastHrTierId, lastHrVariableId, hrJson, reportingWorkplaceJson, reportingHrJson, employeeId, companyName, countryCode, countryId, userType, displayName, reason, remarks, requestType, duration, kpostID, rejoiningDate, ksmaccDisplayName |
| `POST /rolePosting/getEmployeeByCompanyId` (`admin-role-posting-employees`) | adminKsmaccID, rolePostingId, lastWorkplaceTierId, lastWorkplaceVariableId, workplaceJson, workplaceLocationId, workplaceLocaID, lastHrTierId, lastHrVariableId, hrJson, reportingWorkplaceJson, reportingHrJson, employeeId, companyName, countryCode, countryId, userType, displayName, reason, remarks, requestType, duration, kpostID, rejoiningDate, ksmaccDisplayName |
| `POST /rolePosting/getSuspendOrTerminateEmployee` (`admin-role-posting-suspended-list`) | adminKsmaccID, rolePostingId, lastWorkplaceTierId, lastWorkplaceVariableId, workplaceJson, workplaceLocationId, workplaceLocaID, lastHrTierId, lastHrVariableId, hrJson, reportingWorkplaceJson, reportingHrJson, employeeId, companyName, countryCode, countryId, userType, displayName, reason, remarks, duration, kpostID, rejoiningDate, ksmaccDisplayName |
| `POST /rolePosting/getRolePostingByCompanyIdAndEmployeeId` (`admin-role-posting-by-company-and-employee`) | adminKsmaccID, rolePostingId, lastWorkplaceTierId, lastWorkplaceVariableId, workplaceJson, workplaceLocationId, workplaceLocaID, lastHrTierId, lastHrVariableId, hrJson, reportingWorkplaceJson, reportingHrJson, companyName, countryCode, countryId, userType, displayName, reason, remarks, requestType, duration, kpostID, rejoiningDate, ksmaccDisplayName |
| `POST /rolePosting/update` (`admin-role-posting-update`) | lastWorkplaceTierId, lastWorkplaceVariableId, companyId, workplaceJson, workplaceLocationId, lastHrTierId, lastHrVariableId, hrJson, reportingWorkplaceJson, reportingHrJson, countryCode, countryId, kpostID, displayName, activeStatus, reason, remarks, duration, rejoiningDate, ksmaccID, ksmaccCompanyID, ksmaccDisplayName, locationName, workplaceLocationJson, companyName, userType, requestType, employeeDetails, isPromoted, isTransfered, promotionDetails, transferDetails, isKpostIDRequired, isMapped, isHoldOrRelease |
| `POST /rolePosting/delete` (`admin-role-posting-delete`) | lastWorkplaceTierId, lastWorkplaceVariableId, companyId, employeeId, workplaceJson, workplaceLocationId, lastHrTierId, lastHrVariableId, hrJson, reportingWorkplaceJson, reportingHrJson, countryCode, countryId, kpostID, displayName, activeStatus, reason, remarks, duration, rejoiningDate, ksmaccID, ksmaccCompanyID, ksmaccDisplayName, locationName, workplaceLocationJson, companyName, userType, requestType, employeeDetails, isPromoted, isTransfered, promotionDetails, transferDetails, isKpostIDRequired, isMapped, isHoldOrRelease |
| `POST /rolePosting/suspendOrTerminateEmployee` (`admin-role-posting-suspend-terminate`) | adminKsmaccID, rolePostingId, lastWorkplaceTierId, lastWorkplaceVariableId, workplaceJson, workplaceLocationId, workplaceLocaID, lastHrTierId, lastHrVariableId, hrJson, reportingWorkplaceJson, reportingHrJson, companyName, countryCode, countryId, userType, displayName, remarks, duration, kpostID, rejoiningDate, ksmaccDisplayName |
| `POST /employeeDetails/getEmployeeDetails` (`admin-employee-details`) | id, personalInformationObj, residentialObj, mailingObj, employmentObj, educationObj, workExpObj, additionalObj, promotionDetails, transferDetails, locationName |
| `POST /employeeDetails/save` (`admin-employee-save`) | id, personalInformationObj, residentialObj, mailingObj, employmentObj, educationObj, workExpObj, additionalObj, promotionDetails, transferDetails, locationName |
| `POST /employeeDetails/update` (`admin-employee-update`) | personalInformationObj, residentialObj, mailingObj, employmentObj, educationObj, workExpObj, additionalObj, promotionDetails, transferDetails, locationName |
| `POST /employeeDetails/delete` (`admin-employee-delete`) | companyId, personalInformationObj, residentialObj, mailingObj, employmentObj, educationObj, workExpObj, additionalObj, promotionDetails, transferDetails, locationName |

