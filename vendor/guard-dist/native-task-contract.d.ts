//#region src/native-task-contract.d.ts
declare const nativeHash: (value: string) => string;
/** A new, explicitly adopted file-contract lane; historical v6 replay is unchanged.
* Paragraphs retain newlines, commas, conditions and prohibition scope. Every
* source byte is covered; only an exact, host-reviewed source manifest is accepted.
* This bounded adapter does not pretend to interpret arbitrary natural language.
*/
interface ContractSource {
  name: string;
  text: string;
}
interface SourceSpan {
  source: string;
  start: number;
  end: number;
  text: string;
  action: string;
}
declare function objectAction(text: string): string;
declare function compileBoundContract(sources: ContractSource[], expected: Record<string, string>): {
  digest: string;
  spans: SourceSpan[];
};
interface NativeIdentity {
  session: string;
  candidate: string;
  contract: string;
  epoch: string;
  host: string;
  goal: {
    id: string;
    revision: number;
  };
}
interface NativeFacts {
  identity: NativeIdentity;
  hostValid: boolean;
  enabled: boolean;
  sourceValid: boolean;
  oracle: boolean;
  phases: boolean;
  ownTests: boolean;
  audits: boolean;
  supplemental: boolean;
  delivery: boolean;
  constraints: boolean;
  goalValid: boolean;
}
interface NativeCertificate {
  protocol: "native-file-contract/v1";
  identity: NativeIdentity;
  issuedAt: string;
  claims: string[];
  digest: string;
}
/** Host-owned issuer. Text, evidence IDs and model-supplied pass flags cannot
* manufacture a certificate. Restart loses the private key and fails closed.
*/
declare class NativeTaskAuthority {
  #private;
  certify(facts: NativeFacts): {
    certificate?: NativeCertificate;
    blockers: string[];
  };
  current(identity: NativeIdentity): boolean;
  read(): NativeCertificate | undefined;
}
//#endregion
export { ContractSource, NativeCertificate, NativeFacts, NativeIdentity, NativeTaskAuthority, SourceSpan, compileBoundContract, nativeHash, objectAction };