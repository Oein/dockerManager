import express from "express";

const app = express.Router();

app.get("/", (_, res) => {
  res.send("Hello Voltex!");
});

import projectsRouter from "./projects";
app.use("/projects", projectsRouter);

export default app;
