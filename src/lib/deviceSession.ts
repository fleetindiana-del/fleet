import crypto from "crypto";
import mongoose from "mongoose";
import Driver from "@/models/Driver";

/**
 * The phone keeps a device token from the last sign-in and will not ask for a
 * password again until that token is rejected. Rotating it after a name,
 * username, or password change sends the handset back to the sign-in screen,
 * where it checks the account as it stands now.
 */
export async function revokeDeviceSignIns(userId: unknown) {
  const id = String(userId || "");
  if (!id) return;

  const driver = await Driver.findOne({ userId }).select("_id").lean();
  const match: Record<string, string>[] = [{ employeeId: id }];
  if (driver?._id) match.push({ driverId: String(driver._id) });

  const docs = await mongoose.connection
    .collection("deviceenrollments")
    .find({ $or: match })
    .project({ _id: 1 })
    .toArray();

  for (const doc of docs) {
    await mongoose.connection.collection("deviceenrollments").updateOne(
      { _id: doc._id },
      {
        $set: {
          revoked: true,
          deviceToken: crypto.randomBytes(32).toString("hex"),
        },
      }
    );
  }
}

/**
 * People sign in on the phone with their name. When that name was also the
 * username, renaming them keeps the username in step so a server that looks
 * the account up by username still accepts the new name.
 */
export function usernameAfterRename(input: {
  previousName: string;
  previousUsername: string;
  nextName: string;
  submittedUsername?: string;
}): string {
  const previousName = input.previousName.trim();
  const previousUsername = input.previousUsername.trim();
  const nextName = input.nextName.trim();
  const submitted =
    input.submittedUsername === undefined ? previousUsername : input.submittedUsername.trim();

  const nameChanged = nextName.toLowerCase() !== previousName.toLowerCase();
  const usernameLeftAlone = submitted === "" || submitted === previousUsername;
  const usernameWasTheName =
    previousUsername === "" || previousUsername.toLowerCase() === previousName.toLowerCase();

  if (nameChanged && usernameLeftAlone && usernameWasTheName && nextName) {
    return nextName;
  }
  return submitted;
}
