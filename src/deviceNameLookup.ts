import { type SimpleLogger } from "@lmstudio/lms-common";
import { type LMStudioClient } from "@lmstudio/sdk";

export interface DeviceNameResolver {
  localDeviceIdentifier: string | null;
  localDeviceName: string | null;
  isLocal: (deviceIdentifier: string | null) => boolean;
  label: (deviceIdentifier: string | null) => string;
}

export async function createDeviceNameResolver(
  client: LMStudioClient,
  logger: SimpleLogger,
): Promise<DeviceNameResolver> {
  try {
    const status = await client.repository.lmLink.status();
    const remoteDeviceNameByIdentifier = new Map<string, string>();
    for (const peer of status.peers) {
      if (peer.deviceName) {
        remoteDeviceNameByIdentifier.set(peer.deviceIdentifier, peer.deviceName);
      }
    }
    const localDeviceIdentifier = status.deviceIdentifier ?? null;
    const localDeviceName = status.deviceName ?? null;
    return buildResolver(localDeviceIdentifier, localDeviceName, remoteDeviceNameByIdentifier);
  } catch (error) {
    logger.debug("Failed to fetch LM Link status:", error);
    return buildResolver(null, null, new Map<string, string>());
  }
}

function buildResolver(
  localDeviceIdentifier: string | null,
  localDeviceName: string | null,
  remoteDeviceNameByIdentifier: Map<string, string>,
): DeviceNameResolver {
  const isLocal = (deviceIdentifier: string | null) =>
    deviceIdentifier === null || deviceIdentifier === localDeviceIdentifier;
  const label = (deviceIdentifier: string | null) => {
    if (deviceIdentifier === null || deviceIdentifier === localDeviceIdentifier) {
      return localDeviceName ?? "local";
    }
    const remoteDeviceName = remoteDeviceNameByIdentifier.get(deviceIdentifier) ?? null;
    if (remoteDeviceName !== null) {
      return remoteDeviceName;
    }
    return formatUnknownDeviceIdentifier(deviceIdentifier);
  };
  return {
    localDeviceIdentifier,
    localDeviceName,
    isLocal,
    label,
  };
}

function formatUnknownDeviceIdentifier(deviceIdentifier: string): string {
  const prefixLength = 6;
  const prefix = deviceIdentifier.slice(0, prefixLength);
  return `remote:${prefix}`;
}
