const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

exports.createUserRecord = functions.auth.user().onDelete((user) => {
  const doc = admin.firestore().collection("users").doc(user.uid);
  return doc.delete();
});

exports.addMember = functions.firestore
  //executes when a memeber is added to the group and set the count of
  //noUsers to +1 of it current self.
  .document("/GROUPS/{groupID}/MEMBERS/{userID}")
  .onCreate(async (snapshot, context) => {
    const { name } = snapshot.data();
    const groupID = context.params.groupID;
    const increment = admin.firestore.FieldValue.increment(1);
    const groupDoc = await admin.firestore().collection("GROUPS").doc(groupID);
    const documentSnapshot = await groupDoc.get();
    const groupName = documentSnapshot.get("name");

    console.log(`addedmember ${context.params.userID}`);
    groupDoc.collection("MESSAGES").add({
      createdAt: new Date().getTime(),
      text: `${name} Joined the group ${groupName}. `,
      system: true,
    });
    return groupDoc.update({
      noUsers: increment,
    });
  });

exports.removeMember = functions.firestore
  //executes when a memeber is removed or leaves a the group and set the count of
  //noUsers to -1 of it current self.
  .document("/GROUPS/{groupID}/MEMBERS/{userID}")
  .onDelete(async (snapshot, context) => {
    const groupID = context.params.groupID;
    const decrement = admin.firestore.FieldValue.increment(-1);
    const groupDoc = await admin.firestore().collection("GROUPS").doc(groupID);
    const documentSnapshot = await groupDoc.get();
    const currentCount = documentSnapshot.get("noUsers");
    return groupDoc.update({
      noUsers: decrement,
    });
  });

// exports.createGroup = functions.firestore
// //executes when a group is created and adds the group data
// // to the creators groups collection.
//   .document("/GROUPS/{groupID}")
//   .onCreate((snapshot, context) => {
//     console.log("Created!")
//     const groupData = snapshot.data();
//     console.log(groupData)
//     const { name, photoURL, latestMessage } = groupData;
//     return admin
//       .firestore()
//       .collection("users")
//       .doc(context.auth.uid)
//       .collection("GROUPS")
//       .doc(context.params.groupID)
//       .set({
//         name,
//         photoURL,
//         latestMessage,
//       });
//   });

exports.addMessage = functions.firestore
  .document("/GROUPS/{groupID}/MESSAGES/{messageID}")
  .onCreate(async (snapshot, context) => {
    const messageData = snapshot.data();
    const { user } = messageData;
    const { groupID, messageID } = context.params;
    console.log("message added");
    await admin
      .firestore()
      .collection("GROUPS")
      .doc(groupID)
      .collection("MESSAGES")
      .doc(messageID)
      .set(
        {
          pending: false,
          sent: true,
        },
        {
          merge: true,
        }
      );

    let data = messageData;
    data.sent = true;
    data.pending = false;
    await admin.firestore().collection("GROUPS").doc(groupID).set(
      {
        latestMessage: data,
      },
      { merge: true }
    );

    const membersSnapshot = await admin
      .firestore()
      .collection("GROUPS")
      .doc(groupID)
      .collection("MEMBERS")
      .get();

    membersSnapshot.forEach((member) => {
      data.unread = admin.firestore.FieldValue.increment(1);
      let uid = member.id;
     
      if (user) {
        data.user = user;
        data.unread = user._id !== uid ? admin.firestore.FieldValue.increment(1) : 0;
      }
      admin
        .firestore()
        .collection("users")
        .doc(uid)
        .collection("GROUPS")
        .doc(groupID)
        .set(
          {
            latestMessage: data,
          },
          { merge: true }
        );
    });
    return null;
  });

exports.addUserMessage = functions.firestore
  .document("/users/{userID}/CHATS/{otherID}/MESSAGES/{messageID}")
  .onCreate(async (snapshot, context) => {
    const messageData = snapshot.data();
    const { text, createdAt, user, source } = messageData;
    const { userID, otherID, messageID } = context.params;
    console.log("user message added");
    if (source) {
      await admin
        .firestore()
        .collection("users")
        .doc(userID)
        .collection("CHATS")
        .doc(otherID)
        .collection("MESSAGES")
        .doc(messageID)
        .set(
          {
            pending: false,
            sent: true,
          },
          {
            merge: true,
          }
        );
    }

    let data = messageData;
    data.unread = 0;
    data.pending = false;
    data.sent = true;
    if (!source) data.unread = admin.firestore.FieldValue.increment(1);
    admin
      .firestore()
      .collection("users")
      .doc(userID)
      .collection("CHATS")
      .doc(otherID)
      .set(
        {
          latestMessage: data,
        },
        { merge: true }
      );
    if (source) {
      return admin
        .firestore()
        .collection("users")
        .doc(otherID)
        .collection("CHATS")
        .doc(userID)
        .collection("MESSAGES")
        .doc(snapshot.id)
        .set({
          text,
          createdAt,
          user,
          source: false,
        });
    } else {
      return null;
    }
  });

exports.onUserStatusChanged = functions.database
  .ref("/status/{uid}")
  .onUpdate(async (change, context) => {
    // Get the data written to Realtime Database
    const eventStatus = change.after.val();

    // Then use other event data to create a reference to the
    // corresponding Firestore document.
    const userStatusFirestoreRef = admin
      .firestore()
      .doc(`status/${context.params.uid}`);

    // It is likely that the Realtime Database change that triggered
    // this event has already been overwritten by a fast change in
    // online / offline status, so we'll re-read the current data
    // and compare the timestamps.
    const statusSnapshot = await change.after.ref.once("value");
    const status = statusSnapshot.val();
    console.log(status, eventStatus);
    // If the current timestamp for this data is newer than
    // the data that triggered this event, we exit this function.
    if (status.last_changed > eventStatus.last_changed) {
      return null;
    }

    // Otherwise, we convert the last_changed field to a Date
    eventStatus.last_changed = new Date(eventStatus.last_changed);

    // ... and write it to Firestore.
    return userStatusFirestoreRef.set(eventStatus);
  });

//TODO: handle when group name is updated
//TODO: handle when a group is deleted
