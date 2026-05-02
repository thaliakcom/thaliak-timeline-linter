# Changelog

## 0.2.4 (2026-05-02)

* **Added**: "go to definition" action on initial graph step elements, which goes
  to the element definition of that element (14172ab10b13dc5b525ce8c1b96c8d62cf1d2abe)
* **Added**: "go to definition" action on subsequent graph step elements, which
  goes to the initial graph step element of that kind (14172ab10b13dc5b525ce8c1b96c8d62cf1d2abe)
* **Added**: auto completion for graph step keys (0a3c85fa43344ca029904ff5b49f21f263ae7545)
* **Added**: validation for status effects within graph steps (2e6b6e5bb8e693a80be9449fd50edd92546949ae)
* **Fixed**: auto completion for status effects within graph steps (3de6425895caa8acaf96cb5e5bbca4c4682b9ffa)
* **Fixed**: placeholder auto completion taking effect outside of strings (97bb43fe188199ad7c6e0b5cfee3bfa6af2af912)

## 0.2.3 (2026-04-23)

* **Fixed**: special elements being marked as "reserved" even when they're not
  reserved elements (704980e22eb7d7a547dbdd706136043bc7883e79)

## 0.2.2 (2026-04-20)

* **Added**: support for new 'hint' special element (11337c51fa9a2d492c0de8385392ee02b0f302ab)
* **Added**: don't require special elements to be initialized in the first step (11337c51fa9a2d492c0de8385392ee02b0f302ab)
* **Added**: add diagnostic for when a reserved element is defined under elements (11337c51fa9a2d492c0de8385392ee02b0f302ab)

## 0.2.1 (2026-02-05)

* **Fixed**: certain placeholders not being correctly parsed (fbc17f59e39931b4f899a7999098cd19f14deaf8)

## 0.2.0 (2026-02-04)

* **Added**: "make children" code action (select multiple timeline items, then
  use CTRL + Enter to transform all items into children of the first selected item)
  (6c02e88d63fd9047ff9d876228ec1bb5d695b833)
* **Added**: rename refactor (select an ID or placeholder and use F2 to rename it
  across the entire file) (ad40278aa56a8756bc7ec674de5e88a3328fc2d8)
* **Added**: code highlighting for the new placeholder `[boss:c]` (ee9fa732d0cc81f15258bf00dc7c899c79f74244)
* **Added**: new diagnostic "must specify auto attacks" (64f69a67feade78564df4596e1fd2906b6c3b93e)
* **Added**: hover and find reference support for action and status effect keys
  (ab8ca5803d04bc5550e0cd68178cdae4a8168b24)
* **Fixed**: diagnostic "must specify party HP" never being shown (17f9b6e4a69c0e980b3d047a7b1d773dc6255046)
* **Fixed**: hover/go to definition and related actions sometimes not working (b5316414077ef9288f8110deeb0cc14609117fe2)
* **Fixed**: incorrect range check (f0ab52e788102b1f15197870c92abc863ba8fe66)
* **Fixed**: incorrect handling for template placeholders with a suffix (d129fa2f40bd4bca0eb15493e77dfc44cef00437)

## 0.1.7 (2024-09-15)

* **Added**: support for the `<endphase>` item type (f32563e58cffc186e175217b50aade1bf5c69b52)

## 0.1.6 (2024-08-29)

* **Fixed**: handling and highlighting of template placeholder suffixes (d7485ecc960ecc6555ff548d3fb474a67782aa81)

## 0.1.5 (2024-07-21)

* **Fixed**: color picker replacing an incomplete text slice (762e5fae95910c9f526063b0c23a6c929b61d186)

## 0.1.4 (2024-07-21)

* **Added**: diagnostics for `graphing` section (d0d5eeede417beeaac4876f32ba1983e2658d6ea)

## 0.1.3 (2024-07-20)

* Initial release
