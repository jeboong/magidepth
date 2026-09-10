# Release checklist

1. Update package version and npm lock. Run unit tests, actual GPU smoke, and Windows installer tests.
2. Audit tracked files: no private footage, outputs, weights, credentials, caches or logs. Only the explicitly authorized branding character is public.
3. Run `npm run build:icon` and `npm run dist:win`. Inspect unpacked application and NSIS install.
4. Publish `vX.Y.Z` with `MagiDepth-Setup-X.Y.Z.exe`, `.blockmap`, `latest.yml`, and `SHA256SUMS.txt`.
5. Verify public installer and update feed. Keep older assets for delta updates. Do not bundle model weights or FFmpeg executables; these download upstream.

The CI workflow builds after offline tests pass. Tag publishing requires contents write permission. Signing needs a real owner-provided certificate; never commit keys or call an unsigned build signed.

The updater is implemented with download and install UI. Initial release validation can verify the no-update feed; a completed historical upgrade cycle requires a later version. Do not claim that stronger test before actually performing it.

To validate the real published feed against an installed release without downloading or installing an update:

```powershell
$env:MAGIDEPTH_PACKAGED_DIR = "$env:LOCALAPPDATA/Programs/magidepth"
$env:MAGIDEPTH_TEST_UPDATE_FEED = '1'
node scripts/test-electron.cjs
```

This requires the separately provisioned `.test-runtime/data` engine used by the integration harness. The published version must match the installed version. The offline test remains the default. CI keeps already-published release assets unchanged.
