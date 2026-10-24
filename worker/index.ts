import { httpServerHandler } from "cloudflare:node";
import app from "../server/app";

const port = 3001;
app.listen(port);

export default httpServerHandler({ port });
