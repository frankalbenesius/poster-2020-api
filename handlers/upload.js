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

const NORMALIZED_UPLOAD_PATH = "/tmp/converted-image.png";
const POSTER_BEFORE_PATH = "/tmp/poster_before.png";
const POSTER_AFTER_PATH = "/tmp/poster_after.png";

const POSTER_STARTER_BUCKET_PATH = "poster_starter.png";
const SQUARE_SIZE = 650;
const NUM_SQUARES = 72;
const ROOT_TOP = 1250;
const ROOT_LEFT = 100;

export default async (req, res) => {
  try {
    await confirmSubmissionsAreStillOpen();

    const { invitationId, image } = await readMultipartBody(req);
    const invitation = await validateAndGetInvitation(invitationId);

    await storeNormalizedSubmissionLocally(image.path);
    await addNormalizedInvitationToStorage(invitation.id);

    await fetchAndStoreCurrentPosterLocally();
    await addNormalizedImageToLocalPoster({ square: invitation.square });
    await uploadUpdatedPoster();

    res.send("great job!");
  } catch (e) {
    res.status(400).send(e.message || e);
  }
};

async function confirmSubmissionsAreStillOpen() {
  const configDoc = await db.collection("meta").doc("config").get();
  if (!configDoc.exists) {
    throw new Error("could not find config doc");
  }
  const config = configDoc.data();
  const { submissionsAreOpen } = config;
  if (!submissionsAreOpen) {
    throw new Error("submissions are closed");
  } else {
    return;
  }
}

async function uploadUpdatedPoster() {
  const newPosterRef = db.collection("posters").doc();
  const destination = `posters/${newPosterRef.id}.png`;
  const [poster] = await bucket.upload(POSTER_AFTER_PATH, {
    destination,
  });
  await poster.makePublic();
  await newPosterRef.set({
    destination,
    createdOn: adminSDK.firestore.Timestamp.now(),
  });
  await db.collection("meta").doc("config").update({
    latestPosterStoragePath: destination,
  });
}

async function fetchAndStoreCurrentPosterLocally() {
  const configDoc = await db.collection("meta").doc("config").get();
  if (!configDoc.exists) {
    throw new Error("could not find config doc");
  }
  const {
    latestPosterStoragePath = "a default value that does not exist",
  } = configDoc.data();
  const lastestPoster = bucket.file(latestPosterStoragePath);
  const [exists] = await lastestPoster.exists();

  if (exists) {
    await lastestPoster.download({ destination: POSTER_BEFORE_PATH });
  } else {
    await bucket
      .file(POSTER_STARTER_BUCKET_PATH)
      .download({ destination: POSTER_BEFORE_PATH });
  }
}

async function addNormalizedImageToLocalPoster({ square }) {
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
    const newSubmissionRef = db.collection("submissions").doc();
    const destination = `uploads/${newSubmissionRef.id}.png`;
    bucket.upload(NORMALIZED_UPLOAD_PATH, { destination }, (err, newFile) => {
      if (err) {
        reject(err);
      } else {
        newSubmissionRef
          .set({
            destination,
            createdOn: adminSDK.firestore.Timestamp.now(),
            invitationId,
          })
          .then(() => {
            resolve(newFile);
          })
          .catch(reject);
      }
    });
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

    if (invitation.square === null || invitation.square === undefined) {
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

function storeNormalizedSubmissionLocally(imagePath) {
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
