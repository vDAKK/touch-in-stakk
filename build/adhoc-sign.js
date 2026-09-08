'use strict';

// macOS auto-update fix. Squirrel.Mac validates the downloaded bundle's code
// signature before swapping it in, and refuses an inconsistent one — which is
// what we ship, because CSC_IDENTITY_AUTO_DISCOVERY=false leaves the app with
// the Electron binary's original signature while our files have been injected
// into it ("code has no resources but signature indicates they must be
// present"). The download then succeeds and the install silently rolls back on
// every launch.
//
// Re-signing the finished bundle ad-hoc (-s -) makes the signature match its
// contents, which is all Squirrel checks. This is not Apple code signing: it
// carries no identity, so Gatekeeper still quarantines a manually downloaded
// build. It only makes auto-update work.

const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );

  // --deep so nested helpers and frameworks are re-signed too; the outer
  // bundle's seal covers them and Squirrel walks the whole tree.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  });
  // Fail the build rather than publish an unusable update if this did not take.
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
    stdio: 'inherit',
  });

  console.log(`  • ad-hoc signed for Squirrel  ${appPath}`);
};
