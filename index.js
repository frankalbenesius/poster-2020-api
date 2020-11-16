const express = require("express");
const app = express();
const PORT = process.env.PORT || 5000;
const cors = require("cors");

const upload = require("./handlers/upload");

app.use(cors());

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/upload", upload);

app.listen(PORT, () => {
  console.log(`Example app listening at http://localhost:${PORT}`);
});
