import express from "express";
import cors from "cors";

import upload from "./handlers/upload.js";

const PORT = process.env.PORT || 5000;
const app = express();

app.use(cors());

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/upload", upload);

app.listen(PORT, () => {
  console.log(`Example app listening at http://localhost:${PORT}`);
});
