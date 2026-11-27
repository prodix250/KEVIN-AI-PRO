/**
 * Phase 0: Dirty Dozen Security Test Specification for Izi AI Firestore Rules.
 * Verifies all 12 adversarial attack vectors against /users/{userId} and
 * /users/{userId}/private/{docId} are rejected with PERMISSION_DENIED.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; token?: { email?: string; email_verified?: boolean } } | null;
  payload?: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_PAYLOADS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated profile read',
    operation: 'get',
    path: '/users/user123',
    auth: null,
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Cross-user PII snooping',
    operation: 'get',
    path: '/users/victimUid/private/info',
    auth: { uid: 'attackerUid', token: { email_verified: true } },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Collection enumeration / scraping attempt',
    operation: 'list',
    path: '/users',
    auth: { uid: 'attackerUid', token: { email_verified: true } },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Identity spoofing on create',
    operation: 'create',
    path: '/users/victimUid',
    auth: { uid: 'attackerUid', token: { email_verified: false } },
    payload: {
      uid: 'victimUid',
      displayName: 'Spoofed',
      method: 'email',
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow privilege escalation field (isAdmin)',
    operation: 'create',
    path: '/users/attackerUid',
    auth: { uid: 'attackerUid', token: { email_verified: false } },
    payload: {
      uid: 'attackerUid',
      displayName: 'Attacker',
      method: 'email',
      isAdmin: true,
      role: 'superadmin',
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Non-atomic profile creation without /private/info',
    operation: 'create',
    path: '/users/user123',
    auth: { uid: 'user123', token: { email_verified: false } },
    payload: {
      uid: 'user123',
      displayName: 'Test User',
      method: 'email',
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Orphaned private PII document without parent /users/{uid}',
    operation: 'create',
    path: '/users/user123/private/info',
    auth: { uid: 'user123', token: { email_verified: false } },
    payload: {
      uid: 'user123',
      method: 'phone',
      identifier: '+250788123456',
      phone: '+250788123456',
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Unverified account claiming google login method',
    operation: 'create',
    path: '/users/user123',
    auth: { uid: 'user123', token: { email: 'fake@gmail.com', email_verified: false } },
    payload: {
      uid: 'user123',
      displayName: 'Fake Google',
      method: 'google',
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Client-forged backdated createdAt timestamp',
    operation: 'create',
    path: '/users/user123',
    auth: { uid: 'user123', token: { email_verified: false } },
    payload: {
      uid: 'user123',
      displayName: 'Backdated',
      method: 'email',
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Immortal field mutation on update (method/identifier)',
    operation: 'update',
    path: '/users/user123/private/info',
    auth: { uid: 'user123', token: { email_verified: false } },
    payload: {
      identifier: 'hijacked@example.com',
      method: 'google',
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Value poisoning oversized displayName (>100 chars)',
    operation: 'update',
    path: '/users/user123',
    auth: { uid: 'user123', token: { email_verified: true } },
    payload: {
      displayName: 'A'.repeat(250),
      updatedAt: 'SERVER_TIMESTAMP',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Path variable poisoning with invalid characters',
    operation: 'get',
    path: '/users/bad.id$123',
    auth: { uid: 'bad.id$123', token: { email_verified: true } },
    expectedOutcome: 'PERMISSION_DENIED',
  },
];
