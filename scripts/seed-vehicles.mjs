/**
 * Keep one fleet vehicle master for every real (non-test) driver company.
 * Removes junk rows and duplicate copies of the same registration on the same company.
 *
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

/** The vehicle master for the fleet. One row per name; no duplicate copies in the UI. */
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
const FLEET_NAMES = VEHICLES.map((v) => v.registration);

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is missing from .env.local");
  process.exit(1);
}

await mongoose.connect(uri);
const db = mongoose.connection.db;

const driverRows = await db
  .collection("drivers")
  .aggregate([
    { $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "user" } },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        companyId: 1,
        name: { $ifNull: ["$user.name", ""] },
      },
    },
  ])
  .toArray();

const realCompanyIds = [
  ...new Map(
    driverRows
      .filter((d) => d.companyId && !/test/i.test(d.name || ""))
      .map((d) => [String(d.companyId), d.companyId])
  ).values(),
];

if (realCompanyIds.length === 0) {
  console.error("No real driver company to attach vehicles to.");
  process.exit(1);
}

const realIdSet = new Set(realCompanyIds.map((id) => String(id)));

// Drop junk and any fleet copies that do not belong to a real driver company.
const removedJunk = await db.collection("vehicles").deleteMany({
  $or: [
    { registration: { $nin: FLEET_NAMES }, companyId: { $nin: realCompanyIds } },
    { registration: { $nin: FLEET_NAMES } },
    { companyId: { $nin: realCompanyIds } },
  ],
});

// Within each company, keep a single row per registration.
const existing = await db
  .collection("vehicles")
  .find({ registration: { $in: FLEET_NAMES } })
  .sort({ _id: 1 })
  .toArray();
const seen = new Set();
const duplicateIds = [];
for (const doc of existing) {
  const key = `${String(doc.companyId)}|${doc.registration}`;
  if (seen.has(key)) duplicateIds.push(doc._id);
  else seen.add(key);
}
if (duplicateIds.length) {
  await db.collection("vehicles").deleteMany({ _id: { $in: duplicateIds } });
}

for (const companyId of realCompanyIds) {
  for (const vehicle of VEHICLES) {
    await db.collection("vehicles").updateOne(
      { companyId, registration: vehicle.registration },
      {
        $set: {
          companyId,
          registration: vehicle.registration,
          make: vehicle.make,
          vehicleModel: vehicle.vehicleModel,
          status: "active",
        },
      },
      { upsert: true }
    );
  }
  console.log(`${String(companyId)}: ${FLEET_NAMES.join(", ")}`);
}

const kept = await db.collection("vehicles").countDocuments({ registration: { $in: FLEET_NAMES } });
const uniqueNames = await db.collection("vehicles").distinct("registration", {
  registration: { $in: FLEET_NAMES },
});
console.log(
  `Companies ${realCompanyIds.length}, vehicle rows ${kept}, unique names ${uniqueNames.length}, removed junk/orphan ${removedJunk.deletedCount}, removed duplicates ${duplicateIds.length}`
);
console.log(`Fleet: ${uniqueNames.sort().join(", ")}`);
console.log(`Expense types: ${EXPENSE_TYPES.join(", ")}`);
await mongoose.disconnect();
