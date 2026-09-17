export interface FleetDevice {
  deviceId: string;
  employeeName?: string;
  vehicle?: string | { id?: string; registration?: string };
}

export function vehicleLabel(vehicle: FleetDevice["vehicle"]): string | undefined {
  if (!vehicle) return undefined;
  if (typeof vehicle === "string") return vehicle;
  return vehicle.registration || vehicle.id;
}

export function deviceDisplayName(d: FleetDevice): string {
  return d.employeeName?.trim() || vehicleLabel(d.vehicle) || d.deviceId;
}

/** Up to two initials for the avatar dot — "Deepakbhai Khambhala" -> "DK". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
