# Access-time measurement: plain `cat` read (FR-21)

Each record is one run of `node tools/atime-measurement/measure.js <volume-path> --label <label>`.
The script creates a fixture file in a fresh temp subdirectory of the volume path, waits, records atime,
reads the file with `cat` (stdout discarded), records atime again, and removes the directory.
This file records only what was measured.

## internal-apfs

### Record 2026-10-19T03:33:47.878Z

- label: internal-apfs
- path: /tmp/claude-501/atime-measure-Wuvj34
- volume-path argument: /tmp/claude-501
- df -P: Filesystem   512-blocks      Used Available Capacity  Mounted on | /dev/disk3s5  965595304 812243912  62434720    93%    /System/Volumes/Data
- filesystem type (from mount output): /dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse, protect, root data)
- wait between create and read: 1100 ms
- atime before: 2026-10-19T03:33:46.759264478Z
- atime after: 2026-10-19T03:33:47.876858303Z
- atime differs: yes

## external

not measured.

Attempt on 2026-10-19 against an external USB drive (APFS, mounted at `/Volumes/<drive>`; `diskutil info`: Removable Media, Volume Read-Only No, Locked No, Encrypted No, Owners Disabled; mount point mode `drwxrwxr-x`, owned by the running user):

- `node tools/atime-measurement/measure.js /Volumes/<drive> --label external` failed with `EPERM: operation not permitted, mkdtemp '/Volumes/<drive>/atime-measure-XXXXXX'`. Nothing was created on the drive.
- `ls /Volumes/<drive>` failed with `Operation not permitted`.
- Both failed from Claude Code's shell outside its sandbox, and the measurement command also failed from the user's own Terminal.

Why access was refused is not established. macOS privacy controls for removable volumes (System Settings → Privacy & Security → Files and Folders) are one candidate. Granting that access to the terminal app and re-running would show whether it is the cause.

## network

not measured: no such volume available to this run; requires the user's hardware
