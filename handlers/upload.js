import multiparty from "multiparty";
import sharp from "sharp";
import adminSDK from "firebase-admin";

const admin = adminSDK.initializeApp({
  credential: adminSDK.credential.cert(
    JSON.parse(
      Buffer.from(process.env.GOOGLE_CONFIG_BASE64, "base64").toString("ascii")
    )
  ),
  storageBucket: "poster-2020.appspot.com",
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

const snapshot = await db.collection("posters").get();
snapshot.forEach((doc) => {
  console.log(doc.id, "=>", doc.data());
});

bucket.getFiles((err, files) => {
  if (!err) {
    files.forEach((file) => {
      console.log(file.name);
    });
  }
});

// const BUCKET_NAME = "holiday-poster-2019.appspot.com";
// function getPublicURL(bucketName, fileName) {
//   return `https://storage.googleapis.com/${bucketName}/${fileName}`;
// }

const NORMALIZED_UPLOAD_PATH = "/tmp/converted-image.png";
const POSTER_BEFORE_PATH = "/tmp/poster_before.png";
const POSTER_AFTER_PATH = "/tmp/poster_after.png";
const POSTER_BUCKET_PATH = "poster.png";
const POSTER_STARTER_BUCKET_PATH = "poster_starter.png";
const SQUARE_SIZE = 650;
const NUM_SQUARES = 72;
const ROOT_TOP = 1250;
const ROOT_LEFT = 100;

export default async (req, res) => {
  // check if submissions are open...
  try {
    const { invitationId, image } = await readMultipartBody(req);
    const invitation = await validateAndGetInvitation(invitationId);

    await storeNormalizedImageLocally(image.path);
    const newFile = await addNormalizedInvitationToStorage(invitation.id);

    await storeBeforePosterLocally();
    await addNormalizedImageToAfterPoster({ square: invitation.square });
    await updatePosterInStorage();

    res.sendFile(POSTER_AFTER_PATH);
  } catch (e) {
    res.status(400).send(e.message || e);
  }
};

async function updatePosterInStorage() {
  const [poster] = await bucket.upload(POSTER_AFTER_PATH, {
    destination: POSTER_BUCKET_PATH,
  });
  await poster.makePublic();
}

async function storeBeforePosterLocally() {
  const poster = bucket.file(POSTER_BUCKET_PATH);
  const [exists] = await poster.exists();

  if (exists) {
    await poster.download({ destination: POSTER_BEFORE_PATH });
  } else {
    await bucket
      .file(POSTER_STARTER_BUCKET_PATH)
      .download({ destination: POSTER_BEFORE_PATH });
  }
}

async function addNormalizedImageToAfterPoster({ square }) {
  const column = square % 8;
  const row = Math.floor(square / 8);
  const top = ROOT_TOP + row * SQUARE_SIZE;
  const left = ROOT_LEFT + column * SQUARE_SIZE;

  await sharp(POSTER_BEFORE_PATH)
    .composite([{ input: NORMALIZED_UPLOAD_PATH, top, left }])
    .toFile(POSTER_AFTER_PATH);
}

function addNormalizedInvitationToStorage(invitationId) {
  return new Promise((resolve, reject) => {
    bucket.upload(
      NORMALIZED_UPLOAD_PATH,
      { destination: `uploads/${invitationId}.png` },
      (err, newFile) => {
        if (err) {
          reject(err);
        } else {
          resolve(newFile);
        }
      }
    );
  });
}

function generateRandomSquare() {
  return Math.floor(Math.random() * NUM_SQUARES);
}
async function validateAndGetInvitation(invitationId) {
  const invitationDoc = await db
    .collection("invitations")
    .doc(invitationId)
    .get();
  if (!invitationDoc.exists) {
    throw new Error("Invitation does not exist, punk.");
  } else {
    const invitation = invitationDoc.data();

    if (invitation.square === null) {
      const invitationsRef = db.collection("invitations");
      const snapshot = await invitationsRef.where("square", "!=", null).get();
      const claimedSquares = snapshot.docs.map((doc) => doc.data().square);
      if (claimedSquares.length >= NUM_SQUARES) {
        throw new Error("No more squares left to claim!");
      }
      let proposedSquare = generateRandomSquare();
      while (claimedSquares.indexOf(proposedSquare) > -1) {
        proposedSquare = generateRandomSquare();
      }

      await invitationDoc.ref.update({
        square: proposedSquare,
      });

      return {
        ...invitation,
        square: proposedSquare,
      };
    } else {
      return invitation;
    }
  }
}

function storeNormalizedImageLocally(imagePath) {
  return sharp(imagePath)
    .rotate()
    .resize(SQUARE_SIZE, SQUARE_SIZE)
    .toFormat("png")
    .toFile(NORMALIZED_UPLOAD_PATH)
    .then(() => {
      return NORMALIZED_UPLOAD_PATH;
    });
}

function readMultipartBody(req) {
  return new Promise((resolve, reject) => {
    const form = new multiparty.Form();
    form.parse(req, (err, fields, files) => {
      if (err) {
        reject(err);
      }

      const [invitationId] = fields.invitationId || [];
      const [image] = files.image || [];

      if (!invitationId || !image) {
        reject(new Error("Need both invitationId and image in form data."));
      }

      resolve({ invitationId, image });
    });
  });
}

// const squaresRef = db.collection("squares");
// squaresRef
//   .where("invitationId", "==", invitationId)
//   .limit(1)
//   .get()
//   .then((squaresSnapshot) => {
//     if (squaresSnapshot.empty) {
//       return res.status(401).send("Not a valid invitationId, yo.");
//     }

//     const bucket = storage.bucket(BUCKET_NAME);
//     const filename = image.path.replace("/tmp/", "");
//     const uploadOptions = { destination: filename };

// bucket.upload(NORMALIZED_UPLOAD_PATH, uploadOptions, (err, newFile) => {
//   if (err) {
//     res.status(400).send(JSON.stringify(err));
//   }
//   newFile.makePublic().then(() => {
//     const publicUrl = getPublicURL(BUCKET_NAME, filename);
//     squaresSnapshot.forEach((squareDoc) => {
//       const batch = db.batch();
//       const squareData = squareDoc.data();
//       batch.update(squaresRef.doc(squareDoc.id), {
//         image: publicUrl,
//       });
//       batch.set(db.collection("uploads").doc(), {
//         location: squareData.location,
//         image: publicUrl,
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//       });
//       batch.commit().then(() => {
//         return res.status(201).send({
//           location: squareData.location,
//           participant: squareData.participant,
//           image: publicUrl,
//         });
//       });
//     });
//   });
// });
