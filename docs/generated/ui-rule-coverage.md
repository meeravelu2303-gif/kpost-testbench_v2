# Web input-rule coverage

**GENERATED — do not edit.** Written by `tests/framework/ui-rule-coverage.spec.ts`
(`npm run framework`) from the React source. A rule is checked when a test names its text.

- Input rules checked: **72 of 161**
- Server-failure messages checked: **19 of 97**
- Not testable from a browser here: 90

## Input rules (bad input the screen must refuse)

| Screen | Message | Checked |
| ------ | ------- | ------- |
| `auth` | Enter a Valid KpostID / Mobile Number | **no** |
| `auth` | Passwords do not match | **no** |
| `auth` | Invalid Mobile Number | yes |
| `auth` | Mobile number already exists! | yes |
| `auth` | Invalid postal pincode | **no** |
| `auth` | Please select the date using the calendar only | **no** |
| `common/ComposeAssist` | Add a few words for K-AI to help | **no** |
| `common/GlobalDigitalCard` | No Profile Picture available! | **no** |
| `common/VoiceMessagePlayer` | No voice file found | yes |
| `Home/components/RecentMessage` | Meeting Has Ended | **no** |
| `Home/components/RecentMessage` | Send Individual Contact 1 | **no** |
| `K-Booking` | Date not found. | **no** |
| `K-Booking` | Please Check the Departure Point, Arrival Place and Date | yes |
| `K-Booking` | Seat Reserved for Ladies. | **no** |
| `K-Booking` | Error: Payment details could not be retrieved. | **no** |
| `K-Booking` | Please seat seats before selecting the boarding point | **no** |
| `Kall` | No Call History found for the Selected Contact | **no** |
| `Kall/CreateKallModal` | The From Time cannot be in the past. Please select a valid time. | yes |
| `Kall/CreateKallModal` | The To Time cannot be in the past. Please select a valid time. | yes |
| `Kall/CreateKallModal` | The To Time must be after the From Time. Please adjust the timings. | yes |
| `Kall/CreateKallModal` | Start time must be before the end time. | yes |
| `Kall/CreateKallModal` | Start and End times cannot be in the past. Please select valid times. | yes |
| `Kall/KallContact` | Group not Created | **no** |
| `Kall/KallContact` | Please enter a group name | **no** |
| `Kall/KallContainer` | Meeting Has Ended | **no** |
| `Kall/KallHistory` | No Call History found for this Contact | **no** |
| `Kall/KallModal` | User is Blocked. Unblock to make Kall | yes |
| `Kall/KallPage` | You have received new kool kall | **no** |
| `Kall/KoolContainer` | Meeting Has Ended | **no** |
| `Kall/TodayKoolKall` | Meeting Has Ended | **no** |
| `Katchup/AddReference` | Reference name must not be empty. | yes |
| `Katchup/ContactList` | Please enter a group name | **no** |
| `Katchup/ContactList` | Group not Created | **no** |
| `Katchup/ContactList` | Already this contact is saved in contact List | **no** |
| `Katchup/ContactList` | Please select at least one group member | **no** |
| `Katchup/Diary` | Title is required | yes |
| `Katchup/Diary` | Date is required | yes |
| `Katchup/Diary` | Start time is required | yes |
| `Katchup/Diary` | End time is required | yes |
| `Katchup/Diary` | Description is required | yes |
| `Katchup/Diary` | Preferred weeks are required | yes |
| `Katchup/Diary` | Preferred days are required | yes |
| `Katchup/Diary` | End time must be later than start time | yes |
| `Katchup/Diary` | Please select at least one participant. | **no** |
| `Katchup/DigitalCard` | No image available! | **no** |
| `Katchup/DigitalCard` | Please select at least one recipient | **no** |
| `Katchup/forwardFooter` | Enter Your Message | **no** |
| `Katchup/forwardFooter` | Empty Message Cannot be Forwarded ! | **no** |
| `Katchup/forwardFooter` | Please select atleast one contact | **no** |
| `Katchup/forwardFooter` | Empty Message and Without Attachment Cannot be Forwarded ! | **no** |
| `Katchup/forwardFooter` | Select only one message | **no** |
| `Katchup/forwardFooter` | Please select at least one message | **no** |
| `Katchup/forwardFooter` | You can copy only one message at a time. | yes |
| `Katchup/forwardFooter` | Only up to 10 messages should be able to be forward | **no** |
| `Katchup/KatchupMessage` | Please select only one message to forward | **no** |
| `Katchup/KatchupMessage` | Only up to 5 messages can be forwarded at a time | yes |
| `Katchup/KatchupMessage` | Please select atleast one message | **no** |
| `Katchup/KatchupMessage` | Please select a message to copy. | yes |
| `Katchup/KatchupMessage` | Only one message can be selected at a time. | **no** |
| `Katchup/KatchupMessage` | You can copy only one message at a time. | yes |
| `Katchup/KatchupMessage` | No text to copy. | **no** |
| `Katchup/KatchupMessage` | Please Confirm – Click Ok to Save? | **no** |
| `Katchup/KatchupMessage` | Select at least one checkbox to save messages. | yes |
| `Katchup/KatchupMessage` | Error!, Please Try Again After Some Time! | **no** |
| `Katchup/KatchupMessage` | Select at least one checkbox to delete messages. | yes |
| `Katchup/KatchupMessage` | Please select a message to Transfer. | yes |
| `Katchup/KatchupMessage` | No readable text available | **no** |
| `Katchup/KatchupMessage` | No voice file found | yes |
| `Katchup/KatchupMessage` | Selected Contact is already a group member ! | yes |
| `Katchup/KatchupMessage` | Group admins cannot exit the group | yes |
| `Katchup/KatchupMessage` | Single Admin Cannot Exit the group !, Make a Member an Admin to Exit | **no** |
| `Katchup/KatchupMessage` | Each group must have at least one admin. Please add another admin first | yes |
| `Katchup/KatchupMessage` | Cannot Exit this Group, Try Again! | **no** |
| `Katchup/KatchupMessage` | User reached last message | **no** |
| `Katchup/KatchupMessage` | No more messages available | **no** |
| `Katchup/KatchupMessage` | No new messages | **no** |
| `Katchup/KatchupMessage` | Access Denied | **no** |
| `Katchup/KatchupMessage` | Your message is Block | **no** |
| `Katchup/KatchupMessage` | All group members are already admins | yes |
| `Katchup/KatchupMessage` | Only up to 10 messages should be able to be forward | **no** |
| `Katchup/KatchupMessage` | You have some issue | **no** |
| `Katchup/KatchupMessage` | You can Transfer only one message at a time. | yes |
| `Katchup/MessageBox` | Can not able to select more than one message for forward | **no** |
| `Katchup/MultipleContact` | A maximum of 60 members can be selected for copies ! | **no** |
| `Katchup/MultipleContact` | A maximum of 20 members can be selected for Confidential Copy ! | **no** |
| `Katchup/MultipleContact` | You can only Forward with up to 50 contacts and 5 groups | **no** |
| `Katchup/MultipleContact` | Invalid email address | **no** |
| `Katchup/MultipleContact` | Access Denied | **no** |
| `Katchup/MultipleContact` | Access Deneid | **no** |
| `Katchup/RecentMessage` | Could not load recent messages. Please try again. | **no** |
| `Katchup/WriteMessage` | Enter  Message | **no** |
| `Katchup/WriteMessage` | Enter Your Message | **no** |
| `Katchup/WriteMessage` | Please enter a message to post | yes |
| `Katchup/WriteMessage` | Time cannot be set to 00:00:00 | **no** |
| `Katchup/WriteMessage` | There no active Member to select..! Please select the all Members option | **no** |
| `Kdirectory/components` | Reference name must not be empty. | yes |
| `Kdirectory/components` | Invalid postal pincode | **no** |
| `Kdirectory/components/KdirectoryModal` | Invalid postal pincode | **no** |
| `Kdirectory/components/KdirectoryModal` | Reference name must not be empty. | yes |
| `Kmail/KmailContactList` | Group not Created | **no** |
| `Kmail/KmailContactList` | Already this contact is saved in contact List | **no** |
| `Kmail/KmailMessage` | Please select a message to copy. | yes |
| `Kmail/KmailMessage` | Only one mail can be selected at a time. | **no** |
| `Kmail/KmailMessage` | Please select a message to Transfer. | yes |
| `Kmail/KmailMessage` | Selected Contact is already a group member ! | yes |
| `Kmail/KmailMessage` | Single Admin Cannot Exit the group !, Make a Member an Admin to Exit | **no** |
| `Kmail/KmailMessage` | Cannot Exit this Group, Try Again! | **no** |
| `Kmail/KmailMessage` | Access Denied | **no** |
| `Kmail/MailFooter` | Mail Content cannot be empty | yes |
| `Kmail/MailFooter` | Mail could not be sent. Please try again. | **no** |
| `Kmail/writemailbox` | Mail Content cannot be empty | yes |
| `Kmail/writemailbox` | Subject cannot be empty | yes |
| `Kmail/WriteMailPage` | Invalid email id | yes |
| `Kmail/WriteMailPage` | Subject cannot be empty | yes |
| `Kmail/WriteMailPage` | Mail Content cannot be empty | yes |
| `Kmail/WriteMailPage` | Saluation Cannot Be Empty! | yes |
| `Kmail/WriteMailPage` | Invalid mail ID format | yes |
| `Kmail/WriteMailPage` | To or Subject or Mail Content Field cannot be empty | **no** |
| `Kmail/WriteMailPage` | No Data Found | yes |
| `Kmail/WriteMailPage` | You’ve reached the maximum 70 characters! | yes |
| `Kmail/WriteMailPage` | Before Edit Please Select the Salutation | **no** |
| `Kmail/WriteMailPage` | Before Delete Please Select the Saluation | **no** |
| `Kmail/WriteMailPage` | Special Characters are not Allowed! | yes |
| `Settings/BasicInformation` | Please enter a valid email address | yes |
| `Settings/ChangePassword` | Passwords Does Not Match! | **no** |
| `Settings/ChangePassword` | Please fill all fields | yes |
| `Settings/ChangePassword` | Old Password is Incorrect! | yes |
| `Settings/ContactInformation` | Please Fill all the Required Fields | yes |
| `Settings/DeleteAccount` | Please contact the Admin Team.. | **no** |
| `Settings/Education` | Please fill all fields before Save. | yes |
| `Settings/Experience` | Please fill all fields before Save. | yes |
| `Settings/InstantReply` | No data found | yes |
| `Settings/InstantReply` | Instant Reply was not Added | **no** |
| `Settings/OtherActivities` | Please fill all fields before Save. | yes |
| `Settings/OtherMail` | Please select a Gmail ID before proceeding. | yes |
| `Settings/Personalize` | Please upload a wallpaper image first | **no** |
| `Settings/SettingProfile` | Only image files are allowed (JPG, PNG, WEBP, GIF) | yes |
| `UserManagement` | Mobile number already exists! | yes |
| `UserManagement` | Enter a 10-digit mobile number, with or without the country code. | yes |
| `UserManagement` | Invalid mobile number. It should start with a digit between 6 and 9 and be 10 digits long. | yes |
| `UserManagement` | Excel has validation errors | **no** |
| `UserManagement` | Duplicate Designation | **no** |
| `Verticals/Business/MediumLarge/Signup` | Invalid Mobile Number | yes |
| `Verticals/Business/MediumLarge/Signup` | Mobile number already exists! | yes |
| `Verticals/Business/MediumLarge/Signup` | Invalid Email ID | yes |
| `Verticals/Business/MediumLarge/Signup` | Please select the date using the calendar only | **no** |
| `Verticals/Business/MediumLarge/Signup` | Invalid postal pincode | **no** |
| `Verticals/Business/MediumLarge/Signup` | Company name already exists. | yes |
| `Verticals/Business/MediumLarge/Signup` | Only numbers are allowed — no letters or special characters! | **no** |
| `Verticals/Business/Small/Signup` | Invalid Mobile Number | yes |
| `Verticals/Business/Small/Signup` | Mobile number already exists! | yes |
| `Verticals/Business/Small/Signup` | Invalid Email ID | yes |
| `Verticals/Business/Small/Signup` | Please select the date using the calendar only | **no** |
| `Verticals/Business/Small/Signup` | Invalid postal pincode | **no** |
| `Verticals/Business/Small/Signup` | Only numbers are allowed — no letters or special characters! | **no** |
| `Verticals/Personal` | Invalid Mobile Number | yes |
| `Verticals/Personal` | Mobile number already exists! | yes |
| `Verticals/Personal` | Invalid Email ID | yes |
| `Verticals/Personal` | Please select the date using the calendar only | **no** |
| `Verticals/Personal` | Invalid postal pincode | **no** |
| `Verticals/Personal` | Only numbers are allowed — no letters or special characters! | **no** |

## Server-failure messages (forced by failing the call)

| Screen | Message | Checked |
| ------ | ------- | ------- |
| `auth` | Unable to sign in. Check your connection and try again. | **no** |
| `auth` | Unable to update password. Check your connection and try again. | **no** |
| `auth` | Error checking mobile number existence | **no** |
| `auth` | Unable to complete signup. Check your connection and try again. | **no** |
| `common/GlobalDigitalCard` | Error loading image! | **no** |
| `common/SunEditor` | Image upload failed | yes |
| `common/VoiceMessagePlayer` | Error Occured While Translating | **no** |
| `CommonComponent/TransferMessage` | Something went wrong..! | yes |
| `Home` | Something went wrong!! | yes |
| `K-Booking` | Something went wrong! | yes |
| `Kall` | Something went wrong | yes |
| `Kall/KallContact` | Gmail ID is not available for this contact | **no** |
| `Katchup/BlockContact` | Some Error Occurred! | **no** |
| `Katchup/ContactList` | Gmail ID is not available for this contact | **no** |
| `Katchup/ContactList` | Failed to update reference | **no** |
| `Katchup/DeleteContact` | Some Error Occured! | **no** |
| `Katchup/Diary` | Unable to identify event for participant update. | **no** |
| `Katchup/Diary` | Unable to update participants for this task. | **no** |
| `Katchup/Diary` | Unable to update participants. | **no** |
| `Katchup/Diary` | Unable to identify event for delete. | **no** |
| `Katchup/Diary` | Unable to delete task. | **no** |
| `Katchup/Diary` | Unable to update remarks | **no** |
| `Katchup/Diary` | Unable to create schedule. | **no** |
| `Katchup/DigitalCard` | Some Error Occurred! | **no** |
| `Katchup/DigitalCard` | Failed to update the contact. Please try again. | **no** |
| `Katchup/DigitalCard` | Unable to load image | **no** |
| `Katchup/DigitalCard` | QR shared to some recipients. Please retry failed ones. | **no** |
| `Katchup/DigitalCard` | Failed to share QR Code in Katchup | **no** |
| `Katchup/DigitalCard` | Unable to share QR Code in Katchup | **no** |
| `Katchup/DigitalCard` | Failed to share QR Code in KMail | **no** |
| `Katchup/DigitalCard` | Unable to share QR Code in KMail | **no** |
| `Katchup/forwardFooter` | Something went wrong..! | yes |
| `Katchup/KatchupMessage` | Profile upload failed | **no** |
| `Katchup/KatchupMessage` | Some Error Occured!, Please Try Again! | **no** |
| `Katchup/KatchupMessage` | Unable to copy text using fallback method. | **no** |
| `Katchup/KatchupMessage` | Error Occured While Translating | **no** |
| `Katchup/KatchupMessage` | Message is Read By Receiver and Cannot be Recalled | **no** |
| `Katchup/KatchupMessage` | Voice transcription failed | **no** |
| `Katchup/KatchupMessage` | Some Error Occured! | **no** |
| `Katchup/KatchupMessage` | Transcription failed | **no** |
| `Katchup/MessageBox` | Unable to open this document | **no** |
| `Katchup/MessageBox` | File is not available | **no** |
| `Katchup/ProfilePage` | Profile upload failed | **no** |
| `Katchup/ReferenceMsg` | Something Went Wrong! | yes |
| `Katchup/WriteMessage` | This emoji is not available | **no** |
| `Katchup/WriteMessage` | Some Error Occurred!, Please Try Again! | **no** |
| `Katchup/WriteMessage` | Failed to generate. Please try again. | **no** |
| `Katchup/WriteMessage` | Something Went Wrong ! | yes |
| `Katchup/WriteMessage` | Unable to upload voice message | **no** |
| `Kdirectory/components` | Adding Contact Failed | **no** |
| `Kdirectory/components/KdirectoryModal` | Adding Contact Failed | **no** |
| `Kmail` | Something went wrong!! | yes |
| `Kmail/AddOtherDomain` | Some Thing Went wrong! | **no** |
| `Kmail/KmailContactList` | Gmail ID is not available for this contact | **no** |
| `Kmail/KmailMessage` | Unable to load mail content. Please try again. | **no** |
| `Kmail/KmailMessage` | This mail action is not available. | **no** |
| `Kmail/KmailMessage` | Something  Went Wrong | yes |
| `Kmail/KmailMessage` | Some Error Occured! | **no** |
| `Kmail/KmailMessage` | Profile upload failed | **no** |
| `Kmail/KmailMessagebox` | Save is not available for this message. | **no** |
| `Kmail/KmailMessagebox` | Error While Showing Attachment | **no** |
| `Kmail/KmailMessagebox` | Unable to load current read status. | **no** |
| `Kmail/MailFooter` | Some Error Occured! | **no** |
| `Kmail/MailFooter` | Unable to load mail content. Please try again. | **no** |
| `Kmail/StatusType` | Something Went Wrong ! | yes |
| `Kmail/writemailbox` | Some Error Occured! | **no** |
| `Kmail/writemailbox` | Failed to generate. Please try again. | **no** |
| `Kmail/writemailbox` | Something Went Wrong ! | yes |
| `Kmail/WriteMailPage` | Error From Adding Saluation | **no** |
| `Kmail/WriteMailPage` | Mail delivery failed due to invalid email address. | **no** |
| `Kmail/WriteMailPage` | Mail delivery failed | **no** |
| `Kmail/WriteMailPage` | Some Error Occurred! | **no** |
| `Kmail/WriteMailPage` | An unexpected error occurred. | **no** |
| `Kmail/WriteMailPage` | Some Error Occured! | **no** |
| `Kmail/WriteMailPage` | Failed to generate. Please try again. | **no** |
| `Kmail/WriteMailPage` | Something Went Wrong ! | yes |
| `KNews/components/HeadLines` | Something went wrong..! | yes |
| `KNews/components/NewsList` | Something went wrong..! | yes |
| `Settings/BlockedContact` | Something went wrong | yes |
| `Settings/DataStorage` | Error in Data Used List | **no** |
| `Settings/DeleteAccount` | Failed to Deactivate | **no** |
| `Settings/DigitalCardSettings` | Failed to update. Please try again. | **no** |
| `Settings/Experience` | Something went wrong. Please try again. | **no** |
| `Settings/SettingProfile` | Profile remove failed | **no** |
| `Settings/SettingProfile` | Unexpected error occurred | **no** |
| `Settings/SettingProfile` | Profile upload failed | **no** |
| `UserManagement` | some error occured ! | **no** |
| `UserManagement` | Processing Error | yes |
| `UserManagement` | API Error | yes |
| `UserProfile` | Profile upload failed | **no** |
| `Verticals/Business/MediumLarge/Signup` | Error checking mobile number existence | **no** |
| `Verticals/Business/MediumLarge/Signup` | Unable to complete registration. Check your connection and try again. | **no** |
| `Verticals/Business/Small/Signup` | Error checking mobile number existence | **no** |
| `Verticals/Business/Small/Signup` | Something went wrong ! | yes |
| `Verticals/Business/Small/Signup` | Unable to complete registration. Check your connection and try again. | **no** |
| `Verticals/Personal` | Error checking mobile number existence | **no** |
| `Verticals/Personal` | Unable to complete signup. Check your connection and try again. | **no** |

## Not testable from a browser here

| Screen | Message | Why |
| ------ | ------- | ------- |
| `auth` | , error);
        }
      );
    } else {
      //console.error( | a console call, not a message |
| `auth` | Unable to send OTP. Check your connection and try again. | behind an OTP that texts a real phone |
| `auth` | Unable to resend OTP. Check your connection and try again. | behind an OTP that texts a real phone |
| `auth` | Unable to verify OTP. Check your connection and try again. | behind an OTP that texts a real phone |
| `auth` | , error);
  //   }
  // };

  useEffect(() => {
    setOneSignalKey( | a console call, not a message |
| `auth` | Please Paste the OTP with 6 Digits Only! | behind an OTP that texts a real phone |
| `auth` | You are logged out on this device as you logged on another 3rd party device | a session or live-call event |
| `auth` | Your session has expired. Please login again. | a session or live-call event |
| `auth` | Invalid OTP. Please enter the correct code | behind an OTP that texts a real phone |
| `auth` | This module is currently in progress. | a placeholder notice, not a rule |
| `common/AttachmentSummary` | , e);
      } finally {
        setLoading(false);
        setPhase( | a console call, not a message |
| `common/MicInput` | Microphone not available in this browser | needs a device permission the test browser does not grant |
| `common/MicInput` | No speech detected | needs a device permission the test browser does not grant |
| `common/MicInput` | Mic was off | needs a device permission the test browser does not grant |
| `common/MicInput` | , event.error);
      alert( | a console call, not a message |
| `common/VoiceMessagePlayer` | , error);
            toast.error( | a console call, not a message |
| `CustomComponents` | Speech Recognition API not supported in this browser. | needs a device permission the test browser does not grant |
| `CustomComponents` | Microphone not found or access denied. Please ensure a microphone is connected and permissions are granted. | needs a device permission the test browser does not grant |
| `Home/components/RecentMessage` | Group Info Coming Soon | a placeholder notice, not a rule |
| `Home/components/RecentMessage` | KOOL Kall Info Coming Soon | a placeholder notice, not a rule |
| `Kall/GlobalKall_Sender` | Receiver has left the call. | a session or live-call event |
| `Kall/GlobalKall_Sender` | You have left the call. | a session or live-call event |
| `Kall/GlobalKall_Sender` | Kall Rejected | a session or live-call event |
| `Kall/GlobalKall_Sender` | Kall No props.response | a session or live-call event |
| `Kall/GobalRecieveKall` | Sender has left the call. | a session or live-call event |
| `Kall/GobalRecieveKall` | Kall Disconnected! | a session or live-call event |
| `Kall/Kalling` | Kall Rejected | a session or live-call event |
| `Kall/Kalling` | Kall No Response | a session or live-call event |
| `Kall/KallModal` | User Not Connected to Socket | a session or live-call event |
| `Kall/KoolKallModal` | Failed to copy meeting URL. | needs a device permission the test browser does not grant |
| `Katchup` | scroll is working | a placeholder notice, not a rule |
| `Katchup/bubble` | scroll is working | a placeholder notice, not a rule |
| `Katchup/classic` | scroll is working | a placeholder notice, not a rule |
| `Katchup/ContactList` | Group Info Coming Soon | a placeholder notice, not a rule |
| `Katchup/Diary` | Priority is required | unreachable: a plain select that cannot be emptied (Save waits instead; kdiary-validation) |
| `Katchup/Diary` | Repeat type is required | unreachable: a plain select that cannot be emptied (Save waits instead; kdiary-validation) |
| `Katchup/Diary` | Schedule period is required | unreachable: a plain select that cannot be emptied (Save waits instead; kdiary-validation) |
| `Katchup/DigitalCard` | Launching Soon | a placeholder notice, not a rule |
| `Katchup/forwardFooter` | Coming Soon | a placeholder notice, not a rule |
| `Katchup/forwardFooter` | Speech Recognition API not supported in this browser. | needs a device permission the test browser does not grant |
| `Katchup/forwardFooter` | Microphone not found or access denied. Please ensure a microphone is connected and permissions are granted. | needs a device permission the test browser does not grant |
| `Katchup/KatchupMessage` | , compressionError);
    //         toast.error( | a console call, not a message |
| `Katchup/KatchupMessage` | , uploadError);
    //       toast.error( | a console call, not a message |
| `Katchup/KatchupMessage` | , error);
    //     toast.error( | a console call, not a message |
| `Katchup/KatchupMessage` | Unable to copy text to clipboard | needs a device permission the test browser does not grant |
| `Katchup/KatchupMessage` | , error); // Log the actual error
  //             toast.error( | a console call, not a message |
| `Katchup/KatchupMessage` | Clipboard permission denied. | needs a device permission the test browser does not grant |
| `Katchup/KatchupMessage` | Unable to copy to clipboard: | needs a device permission the test browser does not grant |
| `Katchup/KatchupMessage` | Group Info Coming Soon | a placeholder notice, not a rule |
| `Katchup/ProfilePage` | , compressionError);
    //         toast.error( | a console call, not a message |
| `Katchup/ProfilePage` | , error);
    //     toast.error( | a console call, not a message |
| `Katchup/RecentMessage` | Group Info Coming Soon | a placeholder notice, not a rule |
| `Katchup/WriteMessage` | Mic Not Found ! | needs a device permission the test browser does not grant |
| `Katchup/WriteMessage` | Microphone not found or access denied. Please ensure a microphone is connected and permissions are granted. | needs a device permission the test browser does not grant |
| `Katchup/WriteMessage` | Speech Recognition API not supported in this browser. | needs a device permission the test browser does not grant |
| `Katchup/WriteMessage` | Voice recording is not supported in this browser | needs a device permission the test browser does not grant |
| `Kdirectory/components/KdirectoryModal` | Launching Soon | a placeholder notice, not a rule |
| `Kmail/KmailContactList` | Coming soon.. | a placeholder notice, not a rule |
| `Kmail/KmailMessage` | , compressionError);
    //         toast.error( | a console call, not a message |
| `Kmail/KmailMessage` | , uploadError);
    //       toast.error( | a console call, not a message |
| `Kmail/KmailMessage` | , error);
    //     toast.error( | a console call, not a message |
| `Kmail/KmailMessage` | Group info coming soon | a placeholder notice, not a rule |
| `Kmail/MailFooter` | Speech Recognition API not supported in this browser. | needs a device permission the test browser does not grant |
| `Kmail/MailFooter` | Microphone not found or access denied. Please ensure a microphone is connected and permissions are granted. | needs a device permission the test browser does not grant |
| `Kmail/MessageContainer` | Group info coming soon | a placeholder notice, not a rule |
| `Kmail/writemailbox` | Microphone not found or access denied. Please ensure a microphone is connected and permissions are granted. | needs a device permission the test browser does not grant |
| `Kmail/WriteMailPage` | No email ids found in Excel | Bulk Mail is not offered on this build (kmail-validation skips with that reason) |
| `Kmail/WriteMailPage` | , err);
        toast.error(t( | a console call, not a message |
| `Kmail/WriteMailPage` | Mail content is too large. Please reduce the content | Bulk Mail is not offered on this build (kmail-validation skips with that reason) |
| `Kmail/WriteMailPage` | Geolocation is not supported by this browser. | needs a device permission the test browser does not grant |
| `Kmail/WriteMailPage` | Speech Recognition API not supported in this browser. | needs a device permission the test browser does not grant |
| `Kmail/WriteMailPage` | Microphone not found or access denied. Please ensure a microphone is connected and permissions are granted. | needs a device permission the test browser does not grant |
| `Kmail/WriteMailPage` | Permission denied | needs a device permission the test browser does not grant |
| `KPoster` | Could not copy the link. | needs a device permission the test browser does not grant |
| `KPoster` | Could not copy automatically. Select and copy the link below. | needs a device permission the test browser does not grant |
| `Settings/ChangePassword` | , error);
      toast.error( | a console call, not a message |
| `Settings/DeleteAccount` | Please Paste the OTP with 6 Digits Only! | behind an OTP that texts a real phone |
| `Settings/DeleteAccount` | Invalid OTP | behind an OTP that texts a real phone |
| `Settings/Settingdetails` | This module is currently in progress. | a placeholder notice, not a rule |
| `UserProfile` | , compressionError);
    //         toast.error( | a console call, not a message |
| `UserProfile` | , error);
    //     toast.error( | a console call, not a message |
| `Verticals/Business/MediumLarge/Signup` | Error sending OTP to email | behind an OTP that texts a real phone |
| `Verticals/Business/MediumLarge/Signup` | Invalid OTP. Please enter the correct code | behind an OTP that texts a real phone |
| `Verticals/Business/MediumLarge/Signup` | Please Paste the OTP with 6 Digits Only! | behind an OTP that texts a real phone |
| `Verticals/Business/Small/Signup` | Error sending OTP to email | behind an OTP that texts a real phone |
| `Verticals/Business/Small/Signup` | Invalid OTP. Please enter the correct code | behind an OTP that texts a real phone |
| `Verticals/Business/Small/Signup` | Please Paste the OTP with 6 Digits Only! | behind an OTP that texts a real phone |
| `Verticals/Personal` | Error sending OTP to email | behind an OTP that texts a real phone |
| `Verticals/Personal` | Invalid OTP. Please enter the correct code | behind an OTP that texts a real phone |
| `Verticals/Personal` | Please Paste the OTP with 6 Digits Only! | behind an OTP that texts a real phone |
