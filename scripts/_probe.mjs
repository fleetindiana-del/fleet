import dns from "dns";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
const resolver = new dns.Resolver();
resolver.setServers(["1.1.1.1", "8.8.8.8"]);
dns.resolveSrv = (host, cb) => resolver.resolveSrv(host, cb);
dns.resolveTxt = (host, cb) => resolver.resolveTxt(host, cb);

await mongoose.connect(process.env.MONGODB_URI);
const user = await mongoose.connection.collection("users").findOne({ name: "Vedant", role: "driver" });
const rows = await mongoose.connection
  .collection("deviceenrollments")
  .find({ employeeId: String(user._id) })
  .sort({ updatedAt: -1 })
  .toArray();
console.log("phone sign-ins for Vedant:", rows.length, rows.map((r) => (r.revoked ? "revoked" : "active")).join(","));
const live = rows.find((r) => !r.revoked);
await mongoose.disconnect();
if (!live) process.exit(0);

for (const base of ["https://fleet-navy.vercel.app", "http://localhost:3000"]) {
  try {
    const r = await fetch(`${base}/api/driver/me/summary`, {
      headers: { Authorization: `Bearer ${live.deviceToken}` },
    });
    const j = await r.json().catch(() => ({}));
    console.log(base, r.status, j.error ?? `balance=${j.walletBalance} vehicles=${(j.vehicles || []).length}`);
  } catch (e) {
    console.log(base, "unreachable", e.message);
  }
}
