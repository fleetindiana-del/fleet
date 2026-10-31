import dns from "dns";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
const resolver = new dns.Resolver();
resolver.setServers(["1.1.1.1", "8.8.8.8"]);
dns.resolveSrv = (host, cb) => resolver.resolveSrv(host, cb);
dns.resolveTxt = (host, cb) => resolver.resolveTxt(host, cb);

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;
const users = await db.collection("users").find({ role: "driver" }).project({ name: 1, username: 1, email: 1, companyId: 1, capabilities: 1 }).toArray();
for (const u of users) {
  const d = await db.collection("drivers").findOne({ userId: u._id });
  const ledger = d ? await db.collection("ledgerentries").countDocuments({ driverId: d._id }) : 0;
  const exp = d ? await db.collection("expenses").countDocuments({ driverId: d._id }) : 0;
  const enr = await db.collection("deviceenrollments").countDocuments({ employeeId: String(u._id), revoked: { $ne: true } });
  console.log(u.name, "|", u.username, "|", d ? `bal=${d.walletBalance} company=${d.companyId}` : "NO DRIVER", `ledger=${ledger} exp=${exp} activeDevices=${enr}`, JSON.stringify(u.capabilities ?? {}));
}
const vehicles = await db.collection("vehicles").find({}).project({ registration: 1, vehicleModel: 1, companyId: 1, status: 1, odometerKm: 1 }).toArray();
console.log("vehicles", vehicles.map((v) => `${v.registration}(${v.status},${v.odometerKm ?? "-"},${v.companyId})`).join(", "));
const cols = (await db.listCollections().toArray()).map((c) => c.name);
console.log("collections", cols.join(","));
console.log("categories", JSON.stringify(await db.collection("expenses").aggregate([{ $group: { _id: "$category", n: { $sum: 1 } } }]).toArray()));
console.log("noLoc", await db.collection("expenses").countDocuments({ "location.lat": { $exists: false } }));
await mongoose.disconnect();
