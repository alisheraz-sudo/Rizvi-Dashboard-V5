# Rizvi Dashboard V5 — Development Checkpoint

## Current architecture
- Primary target: Native iOS app on iPhone
- Railway: parked/side-lined for now; do not modify or delete
- Trading mode: Manual Trading
- Auto Trading: OFF
- Paper trading: simulated only

## Completed UI/engine work
- Dark V5 trading dashboard layout
- XAU/USD primary symbol + Forex/Crypto selector architecture
- Signal engine and setup lifecycle/stale-signal protection
- BUY/SELL Combo badge with dynamic colors
- HIGH QUALITY + 3-button state
- Compact Entry / TP / SL execution block
- Extra duplicate setup area replaced with mini candle chart
- High / Low / Current Price display
- Backtesting, risk, MTF, regime, liquidity, correlation and journal modules retained
- Premium visual polish retained

## Native iOS build preparation
- Capacitor native configuration present with app ID `com.rizvi.dashboard`
- Capacitor iOS WebView scheme is `rizvi`
- cTrader callback URI: `com.rizvi.dashboard://ctrader/callback`
- cTrader callback scheme is registered separately from the Capacitor WebView scheme
- Native iOS build workflow registers the cTrader callback URL scheme in Info.plist before build
- Workflow verifies callback registration and plist syntax before Xcode build
- Capacitor dependencies pinned to reproducible 7.x versions
- GitHub Actions macOS/iOS simulator build workflow added
- Workflow generates the native iOS project, syncs Capacitor, builds an unsigned simulator app, and uploads an artifact
- Simulator workflow execution verified: Run #17 passed all steps and uploaded `Rizvi-Dashboard-V5-iOS-Simulator` artifact
- Added separate iPhone device build-preparation workflow; it builds an unsigned `iphoneos` app and uploads it as an artifact
- Device build is intentionally unsigned; App Store/TestFlight/iPhone installation still requires Apple signing/provisioning
- Device workflow configuration reviewed and preserved; manual dispatch remains available in GitHub Actions

## Current market-data integration
- Added `ctrader-adapter.js`
- cTrader Open API OAuth flow scaffolded
- Live and demo WebSocket endpoints scaffolded
- Account discovery scaffolded
- FxPro/broker symbol discovery and dynamic symbol mapping scaffolded
- Live bid/ask spot subscription scaffolded
- Live trendbar subscription scaffolded
- Historical trendbar loading scaffolded
- Main and mini charts can consume OHLC bars
- iOS callback/browser flow scaffolded
- Adapter reviewed: no order/new-position/close-position API is present
- Auto Trading remains OFF by design

## Pending
1. Register/configure the cTrader Open API application for the user's FxPro account.
2. Complete and verify native iOS project generation/signing and callback registration.
3. Authorize the user's FxPro cTrader account without exposing credentials in chat.
4. Verify real XAU/USD + selected Forex/Crypto symbols and timeframe candles on iPhone.
5. Run end-to-end signal/backtest/UI regression testing.
6. After iOS is stable, decide whether Railway should remain as a backup or be retired.

## Rule
Add → Test → Fix → Save → Next


## Backup / Future Public Release Safety
- Project is intended to remain private by default.
- A future public edition can be created from a versioned source backup without changing the private production state.
- Backup packages must exclude passwords, API tokens, cTrader client secrets, Apple certificates/private keys, provisioning secrets, and other credentials.
- Preserve source code, native iOS configuration, build workflows, UI, indicators, backtesting logic, cTrader adapter, and this checkpoint/master record.
- If a public edition is created later, use a separate release/version rather than exposing the current private deployment.


## Latest iOS Signing Pipeline Hardening
- Signed iOS workflow now detects the provisioning profile UUID and display name from the supplied profile instead of assuming the profile name equals the bundle ID.
- The workflow validates the provisioning profile application identifier against the configured Apple Team ID + bundle ID.
- Native iOS Info.plist syntax, cTrader OAuth callback registration, bundle identifier presence, and App.xcworkspace presence are validated before signing.
- Signed IPA/TestFlight workflow remains manual-trigger only and has not been executed with real Apple signing credentials yet.
- Railway remains parked and unchanged.


## cTrader Adapter Precision Regression Fix
- Fixed historical trendbar decoding to pass the active symbol ID into the decoder, ensuring historical candles use that instrument's discovered price precision rather than the fallback scale.
- Live spot quote and live candle decoding already use the symbol-specific precision helper.
- This is a code-level fix only; real FxPro authorization/feed still needs end-to-end verification with the user's authorized cTrader account.


## cTrader Disconnect / Stale-Feed Hardening
- Manual disconnect now prevents the adapter's automatic reconnect timer from reopening the connection.
- Disconnect clears the active symbol and marks the broker feed stale/disconnected so old prices are not treated as current live data.
- Automatic reconnect remains available after unexpected connection loss when credentials are configured.


## Universal Fresh-Broker Signal Gate
- Live signal generation now requires a fresh, non-stale broker feed whenever cTrader is authorized, regardless of symbol.
- This prevents BTC/USD, Forex, XAU/USD and other cTrader symbols from retaining or generating live BUY/SELL signals from stale prices after feed interruption.
- Existing XAU/USD non-cTrader feed behavior remains protected by its fresh-feed requirement.


## Feed/Signal UI Synchronization
- Signal notice and feed-block reason now use the active symbol dynamically rather than hard-coded XAU/USD wording.
- When live broker data is stale/unavailable, the active signal is blocked and the dashboard communicates the exact active symbol/feed condition.


## Final Regression Pass — Symbol/TF/OHLC Lifecycle
- Verified symbol and timeframe changes dispatch the cTrader subscription event.
- Verified cTrader adapter writes broker OHLC into the dashboard chart state and maintains real-feed status.
- Hardened symbol switching to clear previous-symbol OHLC immediately, preventing temporary cross-symbol candle display while the new broker subscription loads.
- Signal engine remains gated on fresh broker data and Auto Trading remains OFF.


## Native iPhone Signing Pipeline Review
- Reviewed unsigned iPhone device workflow and manual signed IPA workflow.
- Fixed signed provisioning-profile validation so the Apple Team ID is explicitly available during profile application-identifier validation.
- Native signing remains unexecuted until the required Apple/GitHub Actions signing secrets are configured; no secrets are stored in the repository or chat.
- Simulator build had previously been verified successfully; current device/signing workflow is prepared but not claimed as signed/installable until an actual run succeeds.


## iPhone Signed Run Readiness
- Final native configuration review confirms Capacitor iOS app ID com.rizvi.dashboard, iOS web assets, pinned Capacitor dependencies, and separate cTrader OAuth callback scheme are aligned.
- Signed IPA workflow is ready for a manual GitHub Actions run once Apple signing secrets are configured.
- The available GitHub control interface does not expose manual workflow dispatch, so no signed-run success is claimed here.
- Previously verified simulator build remains the verified native-build baseline.

- Signed workflow now verifies an Apple Distribution signing identity after certificate import, verifies the signed archive, and verifies the exported IPA signature and bundle identifier.
