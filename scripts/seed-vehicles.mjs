/**
 * Upsert the fleet vehicle master (and print the expense types the app already uses).
 *   node scripts/seed-vehicles.mjs
 */
import dns from "dns";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const resolver = new dns.Resolver();
resolver.setServers(["1.1.1.1", "8.8.8.8", "1.0.0.1"]);
dns.resolveSrv = (hostname, cb) => resolver.resolveSrv(hostname, cb);
dns.resolveTxt = (hostname, cb) => resolver.resolveTxt(hostname, cb);

const VEHICLES = [
  { registration: "Mercedes", make: "Mercedes", vehicleModel: "Mercedes" },
  { registration: "KIA", make: "KIA", vehicleModel: "KIA" },
  { registration: "Tucson", make: "Hyundai", vehicleModel: "Tucson" },
  { registration: "Volvo SUV", make: "Volvo", vehicleModel: "Volvo SUV" },
  { registration: "Volvo Electric", make: "Volvo", vehicleModel: "Volvo Electric" },
  { registration: "Scorpio N", make: "Mahindra", vehicleModel: "Scorpio N" },
  { registration: "Espresso", make: "Maruti", vehicleModel: "Espresso" },
];

const EXPENSE_TYPES = ["Petrol", "Food", "Toll", "Parking", "Maintenance", "Other"];

const Company = mongoose.models.Company || mongoose.model("Company", new mongoose.Schema({ name: String }, { collection: "companies" }));
const Vehicle =
  mongoose.models.Vehicle ||
  mongoose.model(
    "Vehicle",
    new mongoose.Schema(
      {
        companyId: mongoose.Schema.Types.ObjectId,
        registration: String,
        make: String,
        vehicleModel: String,
        status: String,
      },
      { collection: "vehicles", timestamps: true }
    )
  );

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is missing from .env.local");
  process.exit(1);
}

await mongoose.connect(uri);
const db = mongoose.connection.db;
const driverRows = await db.collection("drivers").find({}, { projection: { companyId: 1 } }).toArray();
const companyIds = [...new Map(driverRows.filter((d) => d.companyId).map((d) => [String(d.companyId), d.companyId])).values()];
if (companyIds.length === 0) {
  console.error("No driver company to attach vehicles to.");
  process.exit(1);
}

const names = VEHICLES.map((v) => v.registration);
const existing = await db.collection("vehicles").find({ registration: { $in: names } }).sort({ _id: 1 }).toArray();
const seen = new Set();
const extra = [];
for (const doc of existing) {
  const key = `${String(doc.companyId)}|${doc.registration}`;
  if (seen.has(key)) extra.push(doc._id);
  else seen.add(key);
}
if (extra.length) await db.collection("vehicles").deleteMany({ _id: { $in: extra } });

const companyDocs = await Company.find({ _id: { $in: companyIds } }).select("_id name").lean();
const nameById = new Map(companyDocs.map((c) => [String(c._id), c.name]));

for (const companyId of companyIds) {
  for (const vehicle of VEHICLES) {
    await Vehicle.updateOne(
      { companyId, registration: vehicle.registration },
      { $set: { ...vehicle, companyId, status: "active" } },
      { upsert: true }
    );
  }
  console.log(`${nameById.get(String(companyId)) || "Fleet"}: ${names.join(", ")}`);
}

const kept = await db.collection("vehicles").countDocuments({ registration: { $in: names } });
console.log(`Companies ${companyIds.length}, vehicles ${kept}, removed duplicates ${extra.length}`);
console.log(`Expense types: ${EXPENSE_TYPES.join(", ")}`);
await mongoose.disconnect();
