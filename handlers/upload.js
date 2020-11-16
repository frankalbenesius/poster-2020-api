// const db = require("./util/db");
// const admin = require("firebase-admin");
const multiparty = require("multiparty");
const sharp = require("sharp");

// const storage = admin.storage();

// const BUCKET_NAME = "holiday-poster-2019.appspot.com";
// function getPublicURL(bucketName, fileName) {
//   return `https://storage.googleapis.com/${bucketName}/${fileName}`;
// }

const CONVERTED_PATH = "/tmp/converted-image.png";

module.exports = async (req, res) => {
  // check if submissions are open...

  const form = new multiparty.Form();
  form.parse(req, (err, fields, files) => {
    if (err) {
      return res.status(200).send(JSON.stringify(err));
    }

    const [passphrase] = fields.passphrase || [];
    const [image] = files.image || [];

    if (!passphrase || !image) {
      return res
        .status(400)
        .send("Need both passphrase and image in form data.");
    }

    // const squaresRef = db.collection("squares");
    // squaresRef
    //   .where("passphrase", "==", passphrase)
    //   .limit(1)
    //   .get()
    //   .then((squaresSnapshot) => {
    //     if (squaresSnapshot.empty) {
    //       return res.status(401).send("Not a valid passphrase, yo.");
    //     }

    //     const bucket = storage.bucket(BUCKET_NAME);
    //     const filename = image.path.replace("/tmp/", "");
    //     const uploadOptions = { destination: filename };

    sharp(image.path)
      .rotate()
      .resize(675, 675)
      .toFormat("png")
      .toFile(CONVERTED_PATH)
      .then(() => {
        res.sendFile(CONVERTED_PATH);
        // bucket.upload(CONVERTED_PATH, uploadOptions, (err, newFile) => {
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
      });
  });
  //   });
};
