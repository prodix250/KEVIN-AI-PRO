# Izi AI — Firestore Security Specification (Phase 0: Payload-First TDD)

## 1. Data Invariants
1. **Authenticated Ownership**: Every read and write requires `request.auth != null` and `request.auth.uid == userId`. Unauthenticated requests are unconditionally denied by the default-deny safety net (`match /{document=**} { allow read, write: if false; }`).
2. **Account Registration Source of Truth**: An Email or Phone account is only considered registered in the database when BOTH `/users/{userId}` (`UserProfile`) and `/users/{userId}/private/info` (`UserPrivateInfo`) exist.
3. **Atomic Split-Collection Creation**: Creating a user profile (`/users/{userId}`) and creating their private PII record (`/users/{userId}/private/info`) must occur atomically in the same batch (`existsAfter(...)` enforced in both directions).
4. **Strict PII Isolation**: Emails, phone numbers, and login identifiers are stored exclusively inside `/users/{userId}/private/info`, strictly readable only by `request.auth.uid == userId`. Collection `list` queries are disabled (`allow list: if false`).
5. **Immutable Fields & Temporal Integrity**: `uid`, `method`, `identifier`, and `createdAt` cannot be modified after creation; `createdAt` and `updatedAt` must equal `request.time`.
6. **Provider Verification Integrity**: Claiming `method == 'google'` requires `request.auth.token.email_verified == true`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. **Unauthenticated Profile Read (`GET /users/user123`)**: `auth: null` -> Denied.
2. **Cross-User PII Snooping (`GET /users/victimUid/private/info`)**: `auth.uid: "attackerUid"` -> Denied.
3. **Collection Enumeration (`LIST /users`)**: `auth.uid: "attackerUid"` -> Denied (`allow list: if false`).
4. **Identity Spoofing on Create (`CREATE /users/victimUid`)**: `auth.uid: "attackerUid", data.uid: "victimUid"` -> Denied.
5. **Shadow / Ghost Privilege Field (`CREATE /users/attackerUid`)**: Includes extra field `{ ..., isAdmin: true, role: "superadmin" }` -> Denied by `keys().hasOnly(...)`.
6. **Missing PII Atomic Batch (`CREATE /users/user123` alone without `/private/info`)**: Fails `existsAfter(/users/user123/private/info)` -> Denied.
7. **Orphaned Private Info (`CREATE /users/user123/private/info` alone without `/users/user123`)**: Fails `existsAfter(/users/user123)` -> Denied.
8. **Spoofed Google Method Without Verified Email (`CREATE /users/user123`)**: `method: "google"` with `token.email_verified: false` -> Denied.
9. **Client Timestamp Forgery (`CREATE /users/user123`)**: `createdAt: new Date("2020-01-01")` instead of `request.time` -> Denied.
10. **Immortal Field Mutation (`UPDATE /users/user123`)**: Attempts to change `method` or `uid` or `createdAt` -> Denied.
11. **Value Poisoning / Oversight Size Attack (`UPDATE /users/user123`)**: Sets `displayName` to a 5,000-character string (> 100 limit) -> Denied.
12. **Path Poisoning (`GET /users/bad.id$123`)**: Non-alphanumeric path ID failing `isValidId` regex `^[a-zA-Z0-9_-]+$` -> Denied.
