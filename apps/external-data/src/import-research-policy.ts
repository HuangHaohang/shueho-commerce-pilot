import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {Client} from "pg";
import {config} from "./config.js";
import {researchPolicySchema} from "./research-policy.js";
import {getEndpoint,validateEndpointParams} from "./endpoint-registry.js";
const path=process.argv[2];if(!path)throw new Error("Usage: import-research-policy <reviewed-json-path>");
const body=await readFile(path,"utf8"),document=researchPolicySchema.parse(JSON.parse(body));
const identities=new Set<string>();
for(const p of document.social){
 const identity=p.platform+":"+p.objective;if(identities.has(identity))throw new Error("DUPLICATE_SOCIAL_PROFILE");identities.add(identity);
 new Intl.DateTimeFormat("en",{timeZone:p.timezone});
 const endpoint=await getEndpoint(p.endpointId);
 const params={...p.fixedParameters,[p.keywordParameter]:"policy-validation",...(p.dateParameters?{[p.dateParameters.start]:"2026-01-01 00:00:00",[p.dateParameters.end]:"2026-01-02 00:00:00"}:{})};
 validateEndpointParams(endpoint,params);
 if(endpoint.documentationUrl!==p.documentationUrl)throw new Error("POLICY_SOURCE_DOCUMENT_MISMATCH");
 if(p.pagination && !(endpoint.paginationStrategy.requestKeys as string[]).includes(p.pagination.parameter))throw new Error("PAGINATION_NOT_IN_CATALOG");
}
for(const [id,tz] of Object.entries(document.providerTimezones)){await getEndpoint(id);new Intl.DateTimeFormat("en",{timeZone:tz});}
if(!config.migrationDatabaseUrl)throw new Error("Migration credentials required");
const db=new Client({connectionString:config.migrationDatabaseUrl});await db.connect();
try{
 const result=await db.query("INSERT INTO research_policy_import_receipt(source_sha256,source_document,catalog_import_id) SELECT $1,$2::jsonb,id FROM provider_catalog_import_receipt ORDER BY created_at DESC LIMIT 1 ON CONFLICT(source_sha256) DO NOTHING RETURNING id",[createHash("sha256").update(body).digest("hex"),JSON.stringify(document)]);
 if(!result.rowCount && !(await db.query("SELECT 1 FROM research_policy_import_receipt WHERE source_sha256=$1",[createHash("sha256").update(body).digest("hex")])).rowCount)throw new Error("CATALOG_IMPORT_REQUIRED");
 console.log(JSON.stringify({imported:true,sourceSha256:createHash("sha256").update(body).digest("hex")}));
}finally{await db.end();await (await import("./database.js")).database.end();}
