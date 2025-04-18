import express from "express";

const app = express();

import apiRouter from "./api";

app.use(express.json());
app.use((req, res, next) => {
  // allow CORS for all origins
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  next();
});
app.use("/api", apiRouter);

export default app;
