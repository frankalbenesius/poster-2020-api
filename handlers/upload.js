const multiparty = require("multiparty");
const sharp = require("sharp");
const adminSDK = require("firebase-admin");
const { createCanvas, loadImage, registerFont } = require("canvas");
const fs = require("fs");

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
const TEXT_ADDED_PATH = "/tmp/text-added-image.png";
const POSTER_BEFORE_PATH = "/tmp/poster_before.png";
const POSTER_AFTER_PATH = "/tmp/poster_after.png";
const POSTER_PREVIEW_PATH = "/tmp/poster_preview.png";

const POSTER_STARTER_BUCKET_PATH = "poster_starter.png";
const SQUARE_SIZE = 650;
const NUM_SQUARES = 72;
const ROOT_TOP = 1250;
const ROOT_LEFT = 100;
const POSTER_PREVIEW_WIDTH = 18 * 72; // 18 inches times 72ppi

module.exports = async (req, res) => {
  try {
    await confirmSubmissionsAreStillOpen();

    const { invitationId, image } = await readMultipartBody(req);
    const invitation = await validateAndUpdateInvitation(invitationId);

    await storeNormalizedSubmissionLocally(image.path);
    await addTextToNormalizedSubmission(invitation.name);
    await addManipulatedImageToStorage(invitation.id);

    res.send("great job!");

    await fetchAndStoreCurrentPosterLocally();
    await addNormalizedImageToLocalPosters({ square: invitation.square });
    await uploadUpdatedPosters();
  } catch (e) {
    res.status(400).send(e.message || e);
  }
};

async function addTextToNormalizedSubmission(text) {
  registerFont("fonts/FiraMono-Regular.ttf", { family: "Fira Mono " });

  const size = SQUARE_SIZE;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  const image = await loadImage(NORMALIZED_UPLOAD_PATH);
  ctx.drawImage(image, 0, 0, size, size);

  const textSize = 40;
  ctx.font = `${textSize}px "Fira Mono"`;
  const textWidth = ctx.measureText(text).width;
  const textPadding = 10;
  const margin = 0;

  const rectLeft = margin;
  const rectWidth = textWidth + textPadding * 2;
  const rectHeight = textSize + textPadding * 2;
  const rectTop = size - margin - rectHeight;
  ctx.fillStyle = "black";
  ctx.fillRect(rectLeft, rectTop, rectWidth, rectHeight);

  const textBottom = size - margin - textPadding;
  const textLeft = margin + textPadding;
  ctx.fillStyle = "white";
  ctx.fillText(text, textLeft, textBottom);

  const out = fs.createWriteStream(TEXT_ADDED_PATH);
  const stream = canvas.createPNGStream();
  stream.pipe(out);

  return new Promise((resolve) => {
    out.on("finish", () => resolve());
  });
}

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

async function uploadUpdatedPosters() {
  // a new poster document
  const newPosterRef = db.collection("posters").doc();

  // upload full size poster
  const destination = `posters/${newPosterRef.id}.png`;
  const [poster] = await bucket.upload(POSTER_AFTER_PATH, {
    destination,
  });
  await poster.makePublic();

  // upload preview size poster
  const previewDestination = `poster_previews/${newPosterRef.id}.png`;
  const [previewPoster] = await bucket.upload(POSTER_PREVIEW_PATH, {
    destination: previewDestination,
  });
  await previewPoster.makePublic();

  // set values for new poster document
  await newPosterRef.set({
    destination,
    previewDestination,
    createdOn: adminSDK.firestore.Timestamp.now(),
  });

  await db.collection("meta").doc("config").update({
    latestPosterPreviewStoragePath: previewDestination,
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

async function addNormalizedImageToLocalPosters({ square }) {
  const column = square % 8;
  const row = Math.floor(square / 8);
  const top = ROOT_TOP + row * SQUARE_SIZE;
  const left = ROOT_LEFT + column * SQUARE_SIZE;

  await sharp(POSTER_BEFORE_PATH)
    .composite([{ input: TEXT_ADDED_PATH, top, left }])
    .toFile(POSTER_AFTER_PATH);

  await sharp(POSTER_AFTER_PATH)
    .resize(POSTER_PREVIEW_WIDTH)
    .toFile(POSTER_PREVIEW_PATH);
}

function addManipulatedImageToStorage(invitationId) {
  return new Promise((resolve, reject) => {
    const newSubmissionRef = db.collection("submissions").doc();
    const destination = `uploads/${newSubmissionRef.id}.png`;
    bucket.upload(TEXT_ADDED_PATH, { destination }, (err, newFile) => {
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

async function validateAndUpdateInvitation(invitationId) {
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
