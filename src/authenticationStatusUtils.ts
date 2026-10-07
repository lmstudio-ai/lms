import { makePrettyError, text } from "@lmstudio/lms-common";
import {
  type AuthenticationStatus,
  type ComputeDeviceAuthenticationStatus,
  type LoggedInUserAuthenticationStatus,
} from "@lmstudio/lms-shared-types";
import chalk from "chalk";
import { t } from "./i18n/index.js";

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
  const ownerType = t(authenticationStatus.ownerIsOrganization ? "organization" : "user");
  return `${ownerType} ${authenticationStatus.ownerUsername}`;
}

export function formatAuthenticationStatusMessage(
  authenticationStatus: AuthenticationStatus,
): string {
  switch (authenticationStatus.type) {
    case "none":
      return t("You are not currently logged in.");
    case "loggedInUser":
      return t(`You are currently logged in as: {p0}`, { p0: authenticationStatus.userName });
    case "computeDevice":
      return (
        t("You are currently logged in as a compute device for ") +
        formatComputeDeviceOwner(authenticationStatus) +
        "."
      );
    default: {
      const exhaustiveCheck: never = authenticationStatus;
      throw new Error(t(`Unexpected authentication status: {p0}`, { p0: exhaustiveCheck }));
    }
  }
}

export function makeCannotLoginWhileComputeDeviceError(
  authenticationStatus: ComputeDeviceAuthenticationStatus,
): Error {
  return makePrettyError(
    t(
      text`
      Cannot Log In

      This instance is currently logged in as a compute device for
      {p0}.

      To log in as a user, you must log out first using the command
      {p1}.
    `,
      { p0: formatComputeDeviceOwner(authenticationStatus), p1: chalk.yellow("lms logout") },
    ),
  );
}

export function makeCannotLoginAsComputeDeviceWhileLoggedInUserError(
  authenticationStatus: LoggedInUserAuthenticationStatus,
): Error {
  return makePrettyError(
    t(
      text`
      Cannot Log In As Compute Device

      This instance is currently logged in as {p0}.

      To log in as a compute device, you must log out first using the command
      {p1}.
    `,
      { p0: authenticationStatus.userName, p1: chalk.yellow("lms logout") },
    ),
  );
}

export function makeAlreadyLoggedInAsComputeDeviceError(
  authenticationStatus: ComputeDeviceAuthenticationStatus,
): Error {
  return makePrettyError(
    t(
      text`
      Already Logged In As Compute Device

      This instance is currently logged in as a compute device for
      {p0}.

      To log in again, you must first use the command {p1}.
    `,
      { p0: formatComputeDeviceOwner(authenticationStatus), p1: chalk.yellow("lms logout") },
    ),
  );
}
