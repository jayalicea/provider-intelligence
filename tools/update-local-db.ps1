# update-local-db.ps1: refresh what can actually be refreshed today.
# 1. LEIE: check for a newer monthly file, reload if found (self-verifying ingest).
# 2. Verify the seven-state seed completed; report table counts and vintages.

$ErrorActionPreference = 'Continue'
$project = 'C:\Users\casalab\provider-intelligence'
Set-Location $project

Write-Host '=== 1. LEIE monthly refresh ==='
powershell -ExecutionPolicy Bypass -File "$project\tools\monthly-leie-refresh.ps1"

Write-Host ''
Write-Host '=== 2. database snapshot ==='
node -e "const{Client}=require('pg');const fs=require('fs');const e={};for(const l of fs.readFileSync('.env','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);if(m)e[m[1]]=m[2]}const c=new Client({host:'localhost',port:5432,database:'provider_intelligence',user:'admin',password:e.DB_PASSWORD});c.connect().then(async()=>{const q=async(label,sql)=>{const r=await c.query(sql);console.log(label.padEnd(28),JSON.stringify(r.rows[0]))};await q('nppes_providers','SELECT COUNT(*) n FROM nppes_providers');await q('providers (cached NPI)','SELECT COUNT(*) n, COUNT(DISTINCT practice_state) states FROM providers');await q('mips rows','SELECT COUNT(*) n, COUNT(DISTINCT npi) npis FROM mips_performance_scores');await q('quality rows','SELECT COUNT(*) n, COUNT(DISTINCT facility_id) facilities FROM quality_measures');await q('oig_exclusions','SELECT COUNT(*) n, MAX(as_of::text) as_of FROM oig_exclusions');await q('state_exclusions','SELECT COUNT(*) n, MAX(as_of::text) as_of FROM state_exclusions');await c.end()})"

Write-Host ''
Write-Host '=== 3. seed log tail ==='
Get-Content "$project\logs\mips-seed.log" -Tail 4
Write-Host '=== update check finished ==='
