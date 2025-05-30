import express from "express";
import contactRoutes from "./routes/contactRoutes";

const app = express();

app.use(express.json());
app.use("/api", contactRoutes);

export default app;
