import { createHash, createHmac, randomBytes } from "node:crypto";

//#region src/native-task-contract.ts
const nativeHash = (value) => createHash("sha256").update(value).digest("hex");
function objectAction(text) {
	if (/提交[\s\S]*(?:证据|checkpoint|验收|完成标记|LOOP_DONE|promise)/iu.test(text) && !/\bgit\s+commit\b|提交(?:代码|更改|变更|到仓库)/iu.test(text)) return "evidence_submit";
	if (/\bgit\s+commit\b|提交(?:代码|更改|变更|到仓库)/iu.test(text)) return "git_commit";
	if (/(?:创建|create)[\s\S]*\bgoal\b/iu.test(text)) return "goal_create";
	if (/(?:标记|update_goal)[\s\S]*(?:complete|完成)/iu.test(text)) return "goal_complete";
	if (/不要|不得|不可|\b(?:do not|immutable)\b/iu.test(text)) return "constraint";
	return "file_contract";
}
function compileBoundContract(sources, expected) {
	if (sources.length !== Object.keys(expected).length || new Set(sources.map((s) => s.name)).size !== sources.length) throw new Error("source_inventory_mismatch");
	const spans = [];
	for (const source of sources) {
		if (nativeHash(source.text) !== expected[source.name]) throw new Error("unreviewed_contract_source:" + source.name);
		const boundaries = [
			0,
			...Array.from(source.text.matchAll(/\n(?=\n|\d+\. |[一二三四五六]、)/gu), (m) => m.index + 1),
			source.text.length
		];
		for (let i = 0; i < boundaries.length - 1; i++) {
			const start = boundaries[i], end = boundaries[i + 1];
			if (end > start) spans.push({
				source: source.name,
				start,
				end,
				text: source.text.slice(start, end),
				action: objectAction(source.text.slice(start, end))
			});
		}
	}
	return {
		digest: nativeHash(JSON.stringify(sources.map((s) => [s.name, expected[s.name]]))),
		spans
	};
}
/** Host-owned issuer. Text, evidence IDs and model-supplied pass flags cannot
* manufacture a certificate. Restart loses the private key and fails closed.
*/
var NativeTaskAuthority = class {
	#key = randomBytes(32);
	#issued;
	certify(facts) {
		const blockers = Object.entries(facts).filter(([key, value]) => key !== "identity" && value !== true).map(([key]) => key);
		if (blockers.length) {
			this.#issued = void 0;
			return { blockers };
		}
		const body = {
			protocol: "native-file-contract/v1",
			identity: structuredClone(facts.identity),
			issuedAt: (/* @__PURE__ */ new Date()).toISOString(),
			claims: Object.keys(facts).filter((k) => k !== "identity")
		};
		const certificate = {
			...body,
			digest: createHmac("sha256", this.#key).update(JSON.stringify(body)).digest("hex")
		};
		this.#issued = structuredClone(certificate);
		return {
			certificate,
			blockers: []
		};
	}
	current(identity) {
		return this.#issued !== void 0 && JSON.stringify(this.#issued.identity) === JSON.stringify(identity);
	}
	read() {
		return this.#issued ? structuredClone(this.#issued) : void 0;
	}
};

//#endregion
export { NativeTaskAuthority, compileBoundContract, nativeHash, objectAction };