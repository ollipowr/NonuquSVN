// Native in-process shell handler. Keep SVN and Electron out of the shell process.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shlobj.h>
#include <shellapi.h>
#include <strsafe.h>
#include <wrl/client.h>
#include <filesystem>
#include <new>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;
namespace fs = std::filesystem;

// New identity avoids reusing the previous CLR handler cached by a file manager.
const CLSID CLSID_Nonuqu = {0x418857dd, 0xe05b, 0x4b84, {0x9b, 0x24, 0x59, 0x28, 0x2a, 0x53, 0x9c, 0xe4}};
static HMODULE moduleHandle;
static LONG liveObjects;
static LONG serverLocks;

struct Command { const wchar_t* label; const wchar_t* argument; const char* verb; };
static const Command commands[] = {
    {L"Nonuqu \u00f6ffnen", L"", "nonuqu_open"},
    {L"Log anzeigen", L"--log", "nonuqu_log"},
    {L"\u00c4nderungen anzeigen", L"--changes", "nonuqu_changes"},
    {L"Branches verwalten", L"--branches", "nonuqu_branches"},
    {L"Repository-Browser", L"--repo", "nonuqu_repo"},
};

static bool IsDirectory(const fs::path& path) {
    const DWORD attributes = GetFileAttributesW(path.c_str());
    return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY);
}

static bool IsFile(const fs::path& path) {
    const DWORD attributes = GetFileAttributesW(path.c_str());
    return attributes != INVALID_FILE_ATTRIBUTES && !(attributes & FILE_ATTRIBUTE_DIRECTORY);
}

static bool IsWorkingCopy(fs::path path) {
    if (!IsDirectory(path)) return false;
    while (!path.empty()) {
        if (path.filename() == L".svn") return false;
        const auto admin = path / L".svn";
        if (IsFile(admin / L"wc.db") || IsFile(admin / L"entries")) return true;
        auto parent = path.parent_path();
        if (parent == path) break;
        path = std::move(parent);
    }
    return false;
}

static std::wstring Quote(const std::wstring& value) {
    std::wstring result = L"\"";
    size_t slashes = 0;
    for (wchar_t ch : value) {
        if (ch == L'\\') { ++slashes; continue; }
        result.append(ch == L'"' ? slashes * 2 + 1 : slashes, L'\\');
        slashes = 0;
        result += ch;
    }
    result.append(slashes * 2, L'\\');
    return result + L'"';
}

static HRESULT ItemPath(IShellItem* item, std::wstring& path) {
    PWSTR name = nullptr;
    const HRESULT result = item->GetDisplayName(SIGDN_FILESYSPATH, &name);
    if (SUCCEEDED(result)) {
        try { path = name; } catch (...) { CoTaskMemFree(name); throw; }
    }
    CoTaskMemFree(name);
    return result;
}

static HRESULT SelectionPath(PCIDLIST_ABSOLUTE folder, IDataObject* data, std::wstring& path) {
    if (data) {
        // CF_HDROP is used by Explorer and third-party file managers.
        FORMATETC format = {CF_HDROP, nullptr, DVASPECT_CONTENT, -1, TYMED_HGLOBAL};
        STGMEDIUM medium = {};
        if (SUCCEEDED(data->GetData(&format, &medium))) {
            HRESULT result = E_INVALIDARG;
            try {
                if (medium.tymed == TYMED_HGLOBAL &&
                    DragQueryFileW(static_cast<HDROP>(medium.hGlobal), 0xffffffff, nullptr, 0) == 1) {
                    const UINT length = DragQueryFileW(static_cast<HDROP>(medium.hGlobal), 0, nullptr, 0);
                    std::vector<wchar_t> buffer(static_cast<size_t>(length) + 1);
                    if (DragQueryFileW(static_cast<HDROP>(medium.hGlobal), 0, buffer.data(), length + 1)) {
                        path = buffer.data();
                        result = S_OK;
                    }
                }
            } catch (...) { ReleaseStgMedium(&medium); throw; }
            ReleaseStgMedium(&medium);
            return result;
        }
        // Shell ID lists (CIDA) are another standard selection representation.
        ComPtr<IShellItemArray> items;
        HRESULT result = SHCreateShellItemArrayFromDataObject(data, IID_PPV_ARGS(&items));
        if (FAILED(result)) return result;
        DWORD count = 0;
        if (FAILED(items->GetCount(&count)) || count != 1) return E_INVALIDARG;
        ComPtr<IShellItem> item;
        result = items->GetItemAt(0, &item);
        return FAILED(result) ? result : ItemPath(item.Get(), path);
    }
    if (!folder) return E_INVALIDARG;
    ComPtr<IShellItem> item;
    HRESULT result = SHCreateItemFromIDList(folder, IID_PPV_ARGS(&item));
    return FAILED(result) ? result : ItemPath(item.Get(), path);
}

class ShellExtension final : public IShellExtInit, public IContextMenu {
    LONG references = 1;
    std::wstring folder;
    UINT inserted = 0;
public:
    ShellExtension() { InterlockedIncrement(&liveObjects); }
    ~ShellExtension() { InterlockedDecrement(&liveObjects); }
    IFACEMETHODIMP QueryInterface(REFIID id, void** result) override {
        if (!result) return E_POINTER;
        *result = nullptr;
        if (id == IID_IUnknown || id == IID_IShellExtInit) *result = static_cast<IShellExtInit*>(this);
        else if (id == IID_IContextMenu) *result = static_cast<IContextMenu*>(this);
        else return E_NOINTERFACE;
        AddRef();
        return S_OK;
    }
    IFACEMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&references); }
    IFACEMETHODIMP_(ULONG) Release() override {
        const ULONG count = InterlockedDecrement(&references);
        if (!count) delete this;
        return count;
    }
    IFACEMETHODIMP Initialize(PCIDLIST_ABSOLUTE pidl, IDataObject* data, HKEY) override {
        inserted = 0;
        folder.clear();
        try {
            const HRESULT result = SelectionPath(pidl, data, folder);
            if (FAILED(result)) { folder.clear(); return result; }
            if (!IsDirectory(folder)) { folder.clear(); return E_INVALIDARG; }
            return S_OK;
        } catch (...) { folder.clear(); return E_FAIL; }
    }
    IFACEMETHODIMP QueryContextMenu(HMENU menu, UINT index, UINT first, UINT last, UINT flags) override {
        inserted = 0;
        if ((flags & CMF_DEFAULTONLY) || first > last || folder.empty()) return S_OK;
        HMENU submenu = nullptr;
        try {
            if (!IsDirectory(folder)) return S_OK;
            const bool workingCopy = IsWorkingCopy(folder);
            const UINT wanted = workingCopy ? ARRAYSIZE(commands) : 1;
            // Folder and Directory registrations may reach the same menu through different hosts.
            for (int i = 0; i < GetMenuItemCount(menu); ++i) {
                wchar_t label[64] = {};
                GetMenuStringW(menu, i, label, ARRAYSIZE(label), MF_BYPOSITION);
                if (wcscmp(label, L"NonuquSVN") == 0 || wcscmp(label, commands[0].label) == 0) return S_OK;
            }
            if (workingCopy) {
                submenu = CreatePopupMenu();
                if (!submenu) return E_OUTOFMEMORY;
            }
            for (UINT i = 0; i < wanted && static_cast<ULONGLONG>(first) + i <= last; ++i) {
                if (!InsertMenuW(submenu ? submenu : menu, submenu ? i : index,
                    MF_BYPOSITION | MF_STRING, first + i, commands[i].label)) break;
                ++inserted;
            }
            if (submenu && (!inserted || !InsertMenuW(menu, index, MF_BYPOSITION | MF_POPUP,
                reinterpret_cast<UINT_PTR>(submenu), L"NonuquSVN"))) {
                DestroyMenu(submenu);
                inserted = 0;
                return E_FAIL;
            }
            return MAKE_HRESULT(SEVERITY_SUCCESS, 0, inserted);
        } catch (...) {
            if (submenu) DestroyMenu(submenu);
            inserted = 0;
            return E_FAIL;
        }
    }
    IFACEMETHODIMP GetCommandString(UINT_PTR command, UINT flags, UINT*, LPSTR text, UINT capacity) override {
        if (command >= inserted) return E_INVALIDARG;
        if (flags == GCS_VALIDATEA || flags == GCS_VALIDATEW) return S_OK;
        if (!text || !capacity) return E_INVALIDARG;
        if (flags == GCS_VERBA) return StringCchCopyA(text, capacity, commands[command].verb);
        if (flags == GCS_VERBW) {
            return MultiByteToWideChar(CP_UTF8, 0, commands[command].verb, -1,
                reinterpret_cast<LPWSTR>(text), capacity) ? S_OK : E_FAIL;
        }
        if (flags == GCS_HELPTEXTW) return StringCchCopyW(reinterpret_cast<LPWSTR>(text), capacity, commands[command].label);
        return E_NOTIMPL;
    }
    IFACEMETHODIMP InvokeCommand(CMINVOKECOMMANDINFO* info) override {
        if (!info || info->cbSize < sizeof(CMINVOKECOMMANDINFO)) return E_INVALIDARG;
        UINT command = UINT_MAX;
        if (IS_INTRESOURCE(info->lpVerb)) command = LOWORD(reinterpret_cast<UINT_PTR>(info->lpVerb));
        else {
            const auto extended = reinterpret_cast<CMINVOKECOMMANDINFOEX*>(info);
            const bool unicode = info->cbSize >= sizeof(CMINVOKECOMMANDINFOEX) && (info->fMask & CMIC_MASK_UNICODE);
            for (UINT i = 0; i < ARRAYSIZE(commands); ++i) {
                if (unicode && extended->lpVerbW) {
                    wchar_t verb[32];
                    MultiByteToWideChar(CP_UTF8, 0, commands[i].verb, -1, verb, ARRAYSIZE(verb));
                    if (wcscmp(verb, extended->lpVerbW) == 0) command = i;
                } else if (strcmp(commands[i].verb, info->lpVerb) == 0) command = i;
            }
        }
        if (command >= inserted) return E_INVALIDARG;
        try {
            if (!IsDirectory(folder)) return E_FAIL;
            const bool workingCopy = IsWorkingCopy(folder);
            if (command && !workingCopy) return E_FAIL;
            wchar_t modulePath[32768];
            const DWORD length = GetModuleFileNameW(moduleHandle, modulePath, ARRAYSIZE(modulePath));
            if (!length || length >= ARRAYSIZE(modulePath)) return E_FAIL;
            const auto executable = fs::path(modulePath).parent_path().parent_path() / L"NonuquSVN.exe";
            if (!IsFile(executable)) return HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND);
            std::wstring line = Quote(executable.wstring());
            if (workingCopy) line += L" " + std::wstring(commands[command].argument) + L" " + Quote(folder);
            STARTUPINFOW startup = {sizeof(startup)};
            PROCESS_INFORMATION process = {};
            const auto directory = executable.parent_path().wstring();
            if (!CreateProcessW(executable.c_str(), line.data(), nullptr, nullptr, FALSE, 0,
                nullptr, directory.c_str(), &startup, &process)) return HRESULT_FROM_WIN32(GetLastError());
            CloseHandle(process.hThread);
            CloseHandle(process.hProcess);
            return S_OK;
        } catch (...) { return E_FAIL; }
    }
};

class ClassFactory final : public IClassFactory {
    LONG references = 1;
public:
    ClassFactory() { InterlockedIncrement(&liveObjects); }
    ~ClassFactory() { InterlockedDecrement(&liveObjects); }
    IFACEMETHODIMP QueryInterface(REFIID id, void** result) override {
        if (!result) return E_POINTER;
        *result = nullptr;
        if (id != IID_IUnknown && id != IID_IClassFactory) return E_NOINTERFACE;
        *result = static_cast<IClassFactory*>(this);
        AddRef();
        return S_OK;
    }
    IFACEMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&references); }
    IFACEMETHODIMP_(ULONG) Release() override {
        const ULONG count = InterlockedDecrement(&references);
        if (!count) delete this;
        return count;
    }
    IFACEMETHODIMP CreateInstance(IUnknown* outer, REFIID id, void** result) override {
        if (!result) return E_POINTER;
        *result = nullptr;
        if (outer) return CLASS_E_NOAGGREGATION;
        auto extension = new (std::nothrow) ShellExtension();
        if (!extension) return E_OUTOFMEMORY;
        HRESULT status = extension->QueryInterface(id, result);
        extension->Release();
        return status;
    }
    IFACEMETHODIMP LockServer(BOOL lock) override {
        if (lock) InterlockedIncrement(&serverLocks); else InterlockedDecrement(&serverLocks);
        return S_OK;
    }
};

extern "C" HRESULT __stdcall DllGetClassObject(REFCLSID clsid, REFIID iid, void** result) {
    if (!result) return E_POINTER;
    *result = nullptr;
    if (clsid != CLSID_Nonuqu) return CLASS_E_CLASSNOTAVAILABLE;
    auto factory = new (std::nothrow) ClassFactory();
    if (!factory) return E_OUTOFMEMORY;
    const HRESULT status = factory->QueryInterface(iid, result);
    factory->Release();
    return status;
}

extern "C" HRESULT __stdcall DllCanUnloadNow() {
    return !InterlockedCompareExchange(&liveObjects, 0, 0) &&
        !InterlockedCompareExchange(&serverLocks, 0, 0) ? S_OK : S_FALSE;
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) moduleHandle = instance;
    return TRUE;
}
