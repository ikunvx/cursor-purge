# NOTICE

## Upstream dependency: dsh-purge

This plugin interoperates with a **locally installed** copy of
[`dsh-purge`](https://github.com/yohurm/dsh-purge) (also published by
YuJunZhiXue). It imports `lib/redteam/store-core.js` at runtime to reuse the
redteam data layer (`RedteamStore`, `dispatch`).

`dsh-purge` is **commercial software, not open source**. Its license prohibits
copying, modifying, redistributing, selling, white-labelling or publicly
providing its source without written permission.

This repository therefore:

- does **not** vendor, copy or modify any `dsh-purge` source file;
- does **not** include `dsh-purge`'s role prompts or the 23 redteam skill files;
- does **not** redistribute `dsh-purge` in its zip/package;
- only calls the copy already installed and licensed on the user's machine.

Users are responsible for obtaining a valid `dsh-purge` license. If you do not
have one, the plugin's data-layer tools will return a clear "store not found"
error; the plugin itself is still installable but not functional.

## This repository's license

All original code, agents, commands and skills in this repository are licensed
under the MIT License (see `LICENSE`). The MIT license applies only to this
repository's original work, not to `dsh-purge`.

## Trademarks

`DeepSeek Harness`, `dsh-purge` and `Cursor` are names of their respective
projects/companies. This project is an independent integration and is not
endorsed by them.
