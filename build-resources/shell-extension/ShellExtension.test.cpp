#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shlobj.h>
#include <wrl/client.h>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>

using Microsoft::WRL::ComPtr;
namespace fs = std::filesystem;
static void Check(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
static void Success(HRESULT result, const char* message) {
    if (FAILED(result)) { std::cerr << "HRESULT 0x" << std::hex << result << ": "; throw std::runtime_error(message); }
}

// Real Windows data object, restricted to one of the two standard selection formats.
class FormatOnly final : public IDataObject {
    LONG refs = 1;
    ComPtr<IDataObject> source;
    CLIPFORMAT format;
public:
    FormatOnly(IDataObject* data, CLIPFORMAT allowed) : source(data), format(allowed) {}
    IFACEMETHODIMP QueryInterface(REFIID id, void** result) override {
        if (!result) return E_POINTER;
        *result = nullptr;
        if (id != IID_IUnknown && id != IID_IDataObject) return E_NOINTERFACE;
        *result = static_cast<IDataObject*>(this); AddRef(); return S_OK;
    }
    IFACEMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&refs); }
    IFACEMETHODIMP_(ULONG) Release() override { auto n = InterlockedDecrement(&refs); if (!n) delete this; return n; }
    IFACEMETHODIMP GetData(FORMATETC* f, STGMEDIUM* m) override { return f->cfFormat == format ? source->GetData(f, m) : DV_E_FORMATETC; }
    IFACEMETHODIMP QueryGetData(FORMATETC* f) override { return f->cfFormat == format ? source->QueryGetData(f) : DV_E_FORMATETC; }
    IFACEMETHODIMP GetDataHere(FORMATETC*, STGMEDIUM*) override { return E_NOTIMPL; }
    IFACEMETHODIMP GetCanonicalFormatEtc(FORMATETC*, FORMATETC* out) override { out->ptd = nullptr; return DATA_S_SAMEFORMATETC; }
    IFACEMETHODIMP SetData(FORMATETC*, STGMEDIUM*, BOOL) override { return E_NOTIMPL; }
    IFACEMETHODIMP EnumFormatEtc(DWORD direction, IEnumFORMATETC** out) override { return source->EnumFormatEtc(direction, out); }
    IFACEMETHODIMP DAdvise(FORMATETC*, DWORD, IAdviseSink*, DWORD*) override { return OLE_E_ADVISENOTSUPPORTED; }
    IFACEMETHODIMP DUnadvise(DWORD) override { return OLE_E_ADVISENOTSUPPORTED; }
    IFACEMETHODIMP EnumDAdvise(IEnumSTATDATA**) override { return OLE_E_ADVISENOTSUPPORTED; }
};

static ComPtr<IDataObject> Selection(const fs::path& path, bool multiple = false) {
    PIDLIST_ABSOLUTE absolute = nullptr;
    Success(SHParseDisplayName(path.c_str(), nullptr, &absolute, 0, nullptr), "Parse selected folder");
    PIDLIST_ABSOLUTE parent = ILCloneFull(absolute);
    Check(parent != nullptr, "Clone PIDL");
    ILRemoveLastID(parent);
    PCUITEMID_CHILD children[] = {ILFindLastID(absolute), ILFindLastID(absolute)};
    ComPtr<IDataObject> data;
    const HRESULT result = SHCreateDataObject(parent, multiple ? 2 : 1, children, nullptr, IID_PPV_ARGS(&data));
    CoTaskMemFree(parent);
    CoTaskMemFree(absolute);
    Success(result, "Create actual Shell IDataObject");
    return data;
}

static void InitializeBackground(IShellExtInit* init, const fs::path& path) {
    PIDLIST_ABSOLUTE pidl = nullptr;
    Success(SHParseDisplayName(path.c_str(), nullptr, &pidl, 0, nullptr), "Parse background PIDL");
    const HRESULT result = init->Initialize(pidl, nullptr, nullptr);
    CoTaskMemFree(pidl);
    Success(result, "Initialize folder background");
}

static void VerifyMenu(IContextMenu* extension, UINT expected, UINT flags = 0, UINT last = 200) {
    HMENU menu = CreatePopupMenu();
    Check(menu != nullptr, "Create test menu");
    const HRESULT result = extension->QueryContextMenu(menu, 0, 100, last, flags);
    bool valid = result == static_cast<HRESULT>(expected);
    valid = valid && GetMenuItemCount(menu) == (expected ? 1 : 0);
    if (expected) {
        wchar_t label[80] = {};
        GetMenuStringW(menu, 0, label, ARRAYSIZE(label), MF_BYPOSITION);
        HMENU submenu = GetSubMenu(menu, 0);
        if (expected > 1) {
            valid = valid && wcscmp(label, L"NonuquSVN") == 0 && submenu && GetMenuItemCount(submenu) == static_cast<int>(expected);
            valid = valid && GetMenuItemID(submenu, 1) == 101;
            GetMenuStringW(submenu, 1, label, ARRAYSIZE(label), MF_BYPOSITION);
            valid = valid && wcscmp(label, L"Log anzeigen") == 0;
        } else valid = valid && !submenu && wcscmp(label, L"Nonuqu \u00f6ffnen") == 0;
        // This read-only probe also proves the COM vtable and command IDs agree.
        char verb[40] = {};
        valid = valid && SUCCEEDED(extension->GetCommandString(0, GCS_VERBA, nullptr, verb, ARRAYSIZE(verb)));
        valid = valid && strcmp(verb, "nonuqu_open") == 0;
    }
    DestroyMenu(menu);
    Check(valid, "Menu shape, labels, HRESULT and verbs");
}

int wmain(int argc, wchar_t** argv) {
    if (argc != 2) { std::cerr << "Pass a native shell DLL path or --installed.\n"; return 2; }
    if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return 2;
    wchar_t tempBuffer[32768];
    GetTempPathW(ARRAYSIZE(tempBuffer), tempBuffer);
    GUID unique;
    CoCreateGuid(&unique);
    wchar_t guid[40];
    StringFromGUID2(unique, guid, ARRAYSIZE(guid));
    fs::path temp = fs::path(tempBuffer).lexically_normal();
    if (temp.filename().empty()) temp = temp.parent_path();
    const fs::path root = temp / (L"nonuqu-native-test-" + std::wstring(guid));
    HMODULE dll = nullptr;
    int exitCode = 0;
    try {
        fs::create_directories(root / L"plain");
        fs::create_directories(root / L"working copy \u00e4" / L"nested");
        const auto wc = root / L"working copy \u00e4";
        fs::create_directory(wc / L".svn");
        CLSID clsid;
        Success(CLSIDFromString(L"{418857DD-E05B-4B84-9B24-59282A539CE4}", &clsid), "CLSID");
        ComPtr<IShellExtInit> init;
        ComPtr<IClassFactory> factory;
        using CanUnload = HRESULT (STDAPICALLTYPE*)();
        CanUnload canUnload = nullptr;
        if (wcscmp(argv[1], L"--installed") == 0) {
            Success(CoCreateInstance(clsid, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&init)), "Load registered handler");
        } else {
            dll = LoadLibraryW(argv[1]);
            Check(dll != nullptr, "Load native DLL without CLR");
            auto getClass = reinterpret_cast<HRESULT (STDAPICALLTYPE*)(REFCLSID, REFIID, void**)>(GetProcAddress(dll, "DllGetClassObject"));
            canUnload = reinterpret_cast<CanUnload>(GetProcAddress(dll, "DllCanUnloadNow"));
            Check(getClass && canUnload && canUnload() == S_OK, "COM DLL exports");
            Success(getClass(clsid, IID_PPV_ARGS(&factory)), "Load exported COM factory");
            Success(factory->CreateInstance(nullptr, IID_PPV_ARGS(&init)), "Create shell handler through COM");
            Check(canUnload() == S_FALSE, "Live objects prevent unloading");
        }
        ComPtr<IContextMenu> menu;
        Success(init.As(&menu), "Query IContextMenu");
        InitializeBackground(init.Get(), wc);
        VerifyMenu(menu.Get(), 1); // Empty .svn is not sufficient.
        std::ofstream(wc / L".svn" / L"wc.db").put('x');
        for (const auto& path : {root / L"plain", wc, wc / L"nested"}) {
            const UINT expected = path == root / L"plain" ? 1 : 5;
            InitializeBackground(init.Get(), path);
            VerifyMenu(menu.Get(), expected);
            auto selection = Selection(path);
            for (CLIPFORMAT format : {static_cast<CLIPFORMAT>(CF_HDROP), static_cast<CLIPFORMAT>(RegisterClipboardFormatW(CFSTR_SHELLIDLIST))}) {
                ComPtr<IDataObject> filtered;
                filtered.Attach(new FormatOnly(selection.Get(), format));
                Success(init->Initialize(nullptr, filtered.Get(), nullptr), "Initialize actual selected-folder IDataObject");
                VerifyMenu(menu.Get(), expected);
            }
        }
        InitializeBackground(init.Get(), wc);
        VerifyMenu(menu.Get(), 0, CMF_DEFAULTONLY);
        VerifyMenu(menu.Get(), 2, 0, 101);
        CMINVOKECOMMANDINFO invalid = {};
        invalid.cbSize = sizeof(invalid);
        invalid.lpVerb = MAKEINTRESOURCEA(99);
        Check(menu->InvokeCommand(&invalid) == E_INVALIDARG, "Reject an unoffered command");
        auto multiple = Selection(wc, true);
        Check(FAILED(init->Initialize(nullptr, multiple.Get(), nullptr)), "Reject multi-selection without falling back to a parent");
        VerifyMenu(menu.Get(), 0);
        const auto file = wc / L"a.txt";
        std::ofstream(file).put('x');
        auto fileData = Selection(file);
        Check(FAILED(init->Initialize(nullptr, fileData.Get(), nullptr)), "Do not treat a selected file as its parent");
        VerifyMenu(menu.Get(), 0);
        InitializeBackground(init.Get(), wc / L".svn");
        VerifyMenu(menu.Get(), 1);
        menu.Reset(); init.Reset(); factory.Reset();
        if (canUnload) Check(canUnload() == S_OK, "Release COM objects before unload");
        std::cout << "PASS: native COM loader, folder background, HDROP-only and CIDA-only selections, SVN root/subfolder filtering, Unicode, submenu, ID budget and invalid selections (" << sizeof(void*) * 8 << " bit).\n";
    } catch (const std::exception& error) {
        std::cerr << "FAIL: " << error.what() << '\n'; exitCode = 1;
    }
    if (dll) FreeLibrary(dll);
    // Only the unique, generated test tree under the OS temp directory is removed.
    if (root.parent_path().lexically_normal() == temp && root.filename().wstring().find(L"nonuqu-native-test-") == 0) {
        std::error_code ignored;
        fs::remove_all(root, ignored);
    }
    CoUninitialize();
    return exitCode;
}
