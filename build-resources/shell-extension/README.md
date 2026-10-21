# Native shell integration

The DLL implements `IShellExtInit` and `IContextMenu` using the Windows SDK
interfaces, with no CLR or Electron loaded inside the file manager. Both x64
and x86 versions are packaged; the installer registers each in its matching
registry view for Directory, Directory Background, Folder and Drive.

A single selected filesystem folder is accepted through `CF_HDROP` or
`CFSTR_SHELLIDLIST` (CIDA). Background menus use the folder PIDL. Multiple
selections and virtual objects are rejected rather than silently substituting
a parent folder. A `.svn/wc.db` or legacy `.svn/entries` in the folder or an
ancestor enables the SVN submenu. Outside a working copy, only Open appears.
Commands launch the existing app views; the DLL never runs SVN operations.

Build prerequisites: Visual Studio Build Tools, Desktop development with C++,
and a Windows SDK. The CRT is linked statically.

```powershell
npm run build:shell-extension
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-shell-extension.ps1
```

Tests load the actual DLL and exported COM class factory, initialize it with
real Shell data objects (each selection format independently) and inspect the
native menu. This covers the initialization path missing from the previous
managed tests: the old hand-written IDataObject declaration incorrectly used
the IDropTarget IID, so selected-folder initialization failed.

After installing, restart the file manager if it caches menu handlers. The
test executable also accepts `--installed` to validate registered COM loading
for the current user. This is read-only apart from its own temporary fixtures.

The implementation is independent code using the standard native handler
architecture and selection formats also used by TortoiseSVN:
- https://github.com/TortoiseGit/tortoisesvn/blob/master/src/TortoiseShell/ContextMenu.cpp
- https://learn.microsoft.com/windows/win32/shell/shell-and-managed-code

This is the classic Windows shell context menu; on Windows 11 it appears under
Show more options. It does not register a modern IExplorerCommand menu.
