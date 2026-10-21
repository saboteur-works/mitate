v1 store fixture (Feature 3, Task 13)

File: media-organizer-store.json  (the test copies it to <dir>/store.json)

Generating commit
  ba452c4daca63c050926645d701f1a2527aee1af  ("Specs: Feature 3 tasks imported into sab (POS lines)")
  This is the parent of 1ccd182 (the first Feature 3 code, Task 1). Its src/
  is identical to the code before any Feature 3 task, so the store was written
  by the shipped (pre-feature) storage module and collection service.

Steps (a throwaway script, not committed)
  1. git archive ba452c4 src | tar -x -C <tmp>/code
  2. Build a temp tree <ROOT> (realpath) with: photos/a.jpg photos/b.png
     videos/c.mp4 docs/d.txt shared/s.jpg extra/e.jpg gone/g.jpg
  3. With the code from step 1 (openStorage + createCollectionService with a
     fixed idGenerator c1,f1,f2,c2,f3,f4,c3,f5,f6,f7 and the default scan):
       createCollection('Holiday', [photos, shared])   -> c1: f1, f2
       createCollection('Archive', [shared, videos])   -> c2: f3, f4
       createCollection('Mixed',   [docs, gone])       -> c3: f5, f6
     then storage.putFolder f7 (extra, collection c1) + replaceFolderIndex:
     the pre-feature putFolder did not touch folderIds, so f7 is a folder
     record that c1.folderIds does not list.
     then rm -r <ROOT>/gone and service.loadCollections(), which persisted
     f6 as unavailable: true.
  4. Every occurrence of <ROOT> in the written store file was replaced by the
     text @@ROOT@@. The tests replace it with a fresh temp directory before
     opening. createdAt values are the generation time and are not asserted.

Contents (what the tests assert)
  collections: c1 "Holiday" folderIds [f1,f2]   (f7 missing from folderIds)
               c2 "Archive" folderIds [f3,f4]
               c3 "Mixed"   folderIds [f5,f6]
  folders:     f1 c1 @@ROOT@@/photos  2 files (a.jpg, b.png)
               f2 c1 @@ROOT@@/shared  1 file  (s.jpg)
               f3 c2 @@ROOT@@/shared  1 file  (s.jpg)   same path as f2, separate record
               f4 c2 @@ROOT@@/videos  1 file  (c.mp4)
               f5 c3 @@ROOT@@/docs    1 file  (d.txt)
               f6 c3 @@ROOT@@/gone    1 file  (g.jpg)   unavailable: true
               f7 c1 @@ROOT@@/extra   1 file  (e.jpg)   not in c1.folderIds
  index: 7 folder entries, 8 file records in total; access: empty.
