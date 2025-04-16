import express from "express";

const app = express();

import apiRouter from "./api";

app.use(express.json());
app.use("/api", apiRouter);

export default app;
