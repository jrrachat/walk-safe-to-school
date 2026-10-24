import express from "express";
import app from "./app";

app.use(express.static("dist"));
app.listen(Number(process.env.PORT) || 3001, "127.0.0.1", () =>
  console.log("Walkwise Atlanta API: http://127.0.0.1:3001"),
);
