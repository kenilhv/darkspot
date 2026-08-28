#!/usr/bin/env bash
# The live proof for the "grounded chat" part of the demo: a real MCP tools/call against the
# real tool server, going through the same code path LibreChat's MCP client uses - just without
# LibreChat's agent-orchestration layer in between, which is not yet proven to invoke it reliably
# (see COORDINATION.md, ~16:3x entry, and DEMO.md "known gaps").
#
# Run from the repo root:  bash scripts/demo-tool-call.sh ["<region>"]
set -euo pipefail
REGION="${1:-Trishuli}"
ENV_FILE="../darkspot-chat/apps/chat/librechat/.env"
SECRET=$(grep TOOLS_SHARED_SECRET "$ENV_FILE" | cut -d= -f2)

docker exec librechat-darkspot-tools-1 node -e "
const s='$SECRET';
const region='$REGION';
const call=(body)=>fetch('http://localhost:3311/mcp',{method:'POST',headers:{'content-type':'application/json','accept':'application/json, text/event-stream','X-DarkSpot-Tools-Token':s,'X-DarkSpot-Subject':'demo','X-DarkSpot-Subject-Email':'supervisor@darkspot.local'},body:JSON.stringify(body)}).then(r=>r.text());
(async()=>{
  await call({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'demo',version:'1'}}});
  const r = await call({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'get_priority_ranking',arguments:{region}}});
  const m = r.match(/data: (.*)/);
  const parsed = JSON.parse(m[1]);
  console.log(parsed.result.content[0].text);
})();
"
