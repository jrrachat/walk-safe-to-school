const os = require("node:os");

try {
  os.userInfo();
} catch {
  // tsx uses the username to name its cache directory. Some restricted
  // Windows environments cannot resolve it through Node's OS API.
  os.userInfo = () => ({ username: process.env.USERNAME || "local-user" });
}
