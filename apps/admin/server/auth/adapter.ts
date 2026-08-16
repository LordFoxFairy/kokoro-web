import "server-only";

import type { Adapter } from "next-auth/adapters";

import type { IamAuthAdapterClient } from "../iam/auth-adapter-client";

export function createIamAuthAdapter(client: IamAuthAdapterClient): Adapter {
  const adapter: Adapter = {
    createUser: (user) => client.createUser(user),
    getUser: (id) => client.getUser(id),
    getUserByEmail: (email) => client.getUserByEmail(email),
    getUserByAccount: (key) => client.getUserByAccount(key),
    updateUser: (user) => client.updateUser(user),
    deleteUser: async (id) => client.deleteUser(id),
    linkAccount: (account) => client.linkAccount(account),
    unlinkAccount: async (key) => client.unlinkAccount(key),
    createSession: (session) => client.createSession(session),
    getSessionAndUser: (token) => client.getSessionAndUser(token),
    updateSession: (session) => client.updateSession(session),
    deleteSession: async (token) => client.deleteSession(token),
    createVerificationToken: (token) => client.createVerificationToken(token),
    useVerificationToken: (key) => client.useVerificationToken(key),
  };
  return Object.freeze(adapter);
}
