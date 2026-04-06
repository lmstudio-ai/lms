import { makePrettyError, text } from "@lmstudio/lms-common";
import {
  type AuthenticationStatus,
  type ComputeDeviceAuthenticationStatus,
  type LoggedInUserAuthenticationStatus,
} from "@lmstudio/lms-shared-types";
import chalk from "chalk";

interface LegacyLoggedInUserAuthenticationStatus {
  userName: string;
}

export function normalizeAuthenticationStatus(
  rawAuthenticationStatus: AuthenticationStatus | LegacyLoggedInUserAuthenticationStatus | null,
): AuthenticationStatus {
  if (rawAuthenticationStatus === null) {
    return {
      type: "none",
    };
  }
  if ("type" in rawAuthenticationStatus) {
    return rawAuthenticationStatus;
  }
  return {
    type: "loggedInUser",
    userName: rawAuthenticationStatus.userName,
  };
}

export function formatComputeDeviceOwner(
  authenticationStatus: ComputeDeviceAuthenticationStatus,
): string {
  const ownerType = authenticationStatus.ownerIsOrganization ? "organization" : "user";
  return `${ownerType} ${authenticationStatus.ownerUsername}`;
}

export function formatAuthenticationStatusMessage(authenticationStatus: AuthenticationStatus): string {
  switch (authenticationStatus.type) {
    case "none":
      return "You are not currently logged in.";
    case "loggedInUser":
      return `You are currently logged in as: ${authenticationStatus.userName}`;
    case "computeDevice":
      return (
        "You are currently logged in as a compute device for " +
        formatComputeDeviceOwner(authenticationStatus) +
        "."
      );
    default: {
      const exhaustiveCheck: never = authenticationStatus;
      throw new Error(`Unexpected authentication status: ${exhaustiveCheck}`);
    }
  }
}

export function makeCannotLoginWhileComputeDeviceError(
  authenticationStatus: ComputeDeviceAuthenticationStatus,
): Error {
  return makePrettyError(
    text`
      Cannot Log In

      This instance is currently logged in as a compute device for
      ${formatComputeDeviceOwner(authenticationStatus)}.

      To log in as a user, you must log out first using the command
      ${chalk.yellow("lms logout")}.
    `,
  );
}

export function makeCannotLoginAsComputeDeviceWhileLoggedInUserError(
  authenticationStatus: LoggedInUserAuthenticationStatus,
): Error {
  return makePrettyError(
    text`
      Cannot Log In As Compute Device

      This instance is currently logged in as ${authenticationStatus.userName}.

      To log in as a compute device, you must log out first using the command
      ${chalk.yellow("lms logout")}.
    `,
  );
}

export function makeAlreadyLoggedInAsComputeDeviceError(
  authenticationStatus: ComputeDeviceAuthenticationStatus,
): Error {
  return makePrettyError(
    text`
      Already Logged In As Compute Device

      This instance is currently logged in as a compute device for
      ${formatComputeDeviceOwner(authenticationStatus)}.

      To log in again, you must first use the command ${chalk.yellow("lms logout")}.
    `,
  );
}
