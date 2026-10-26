export type MarkdownAlign = 'right'|'left'|'center'|'justify';
export type MarkdownDirection = 'rtl'|'ltr';
export type MarkdownPalette = {
    background:string; surface:string; text:string; border:string;
    heading1:string; heading2:string; heading3:string;
    bold:string; italic:string; link:string; quote:string; formula:string;
    inlineCodeText:string; inlineCodeBackground:string;
    codeText:string; codeBackground:string;
};
export type MarkdownCustomTheme = {id:string;name:string;palette:MarkdownPalette;builtIn?:string};
export type MarkdownSettings = {
    font:string; fontSize:number; lineHeight:number; align:MarkdownAlign; direction:MarkdownDirection;
    textAttachmentPosition:'start'|'end';
    theme:string; showToolbar:boolean; wrap:boolean; wide:boolean;
};

export const markdownFonts=[
    {value:'vazir',label:'وزیرمتن'},{value:'yekan',label:'یکان'},{value:'iransans',label:'ایران‌سنس'},
    {value:'zar',label:'زر'},{value:'bnazanin',label:'بی‌نازنین'},{value:'tahoma',label:'تاهوما'},
    {value:'serif',label:'نسخ'},{value:'inter',label:'Inter'},{value:'georgia',label:'Georgia'},
    {value:'merriweather',label:'Merriweather'},{value:'mono',label:'قلم کدنویسی'},
];
export const markdownBuiltInThemes=[
    {value:'dark',label:'مشکی',color:'#05070b'},{value:'gray',label:'خاکستری',color:'#242933'},
    {value:'cream',label:'کاغذی',color:'#efe4ca'},{value:'white',label:'روز',color:'#ffffff'},
    {value:'ocean',label:'اقیانوس',color:'#082735'},{value:'forest',label:'جنگل',color:'#10291d'},
    {value:'plum',label:'آلویی',color:'#27172f'},{value:'sepia',label:'سپیا',color:'#3a2b20'},
];
export const defaultMarkdownPalette:MarkdownPalette={
    background:'#05070b',surface:'#111620',text:'#f1f5f9',border:'#334155',
    heading1:'#e9d5ff',heading2:'#bae6fd',heading3:'#ddd6fe',bold:'#fde68a',italic:'#ddd6fe',
    link:'#7dd3fc',quote:'#ede9fe',formula:'#c4b5fd',inlineCodeText:'#a5f3fc',inlineCodeBackground:'#164e63',
    codeText:'#e2e8f0',codeBackground:'#10141d',
};

export const markdownBuiltInPalettes:Record<string,MarkdownPalette>={
    dark:{...defaultMarkdownPalette},
    gray:{...defaultMarkdownPalette,background:'#242933',surface:'#2c323d',border:'#4a5260'},
    cream:{...defaultMarkdownPalette,background:'#efe4ca',surface:'#fff7e4',text:'#342f28',border:'#cabd9f',heading1:'#81552e',heading2:'#81552e',heading3:'#81552e',bold:'#81552e',italic:'#6f4d2f',link:'#81552e',quote:'#6f4d2f',formula:'#81552e',inlineCodeText:'#292524',inlineCodeBackground:'#eadfc7'},
    white:{...defaultMarkdownPalette,background:'#ffffff',surface:'#ffffff',text:'#182033',border:'#d8dee8',heading1:'#81552e',heading2:'#81552e',heading3:'#81552e',bold:'#81552e',italic:'#6f4d2f',link:'#81552e',quote:'#5b6475',formula:'#81552e',inlineCodeText:'#292524',inlineCodeBackground:'#eef2f7'},
    ocean:{...defaultMarkdownPalette,background:'#071a24',surface:'#0a2430',text:'#e0f2fe',border:'#155e75',heading1:'#7dd3fc',heading2:'#7dd3fc',heading3:'#7dd3fc',bold:'#7dd3fc',italic:'#bae6fd',link:'#7dd3fc',quote:'#bae6fd',formula:'#7dd3fc'},
    forest:{...defaultMarkdownPalette,background:'#0c1b15',surface:'#10251c',text:'#ecfdf5',border:'#166534',heading1:'#6ee7b7',heading2:'#6ee7b7',heading3:'#6ee7b7',bold:'#6ee7b7',italic:'#a7f3d0',link:'#6ee7b7',quote:'#a7f3d0',formula:'#6ee7b7'},
    plum:{...defaultMarkdownPalette,background:'#1d1124',surface:'#291832',text:'#fae8ff',border:'#6b217e',heading1:'#e9a8ff',heading2:'#e9a8ff',heading3:'#e9a8ff',bold:'#e9a8ff',italic:'#f5d0fe',link:'#e9a8ff',quote:'#f5d0fe',formula:'#e9a8ff'},
    sepia:{...defaultMarkdownPalette,background:'#302219',surface:'#3b2a1f',text:'#f5e7d4',border:'#765a43',heading1:'#f0bd79',heading2:'#f0bd79',heading3:'#f0bd79',bold:'#f0bd79',italic:'#fed7aa',link:'#f0bd79',quote:'#fed7aa',formula:'#f0bd79'},
};

const SETTINGS_KEY='komod-markdown-settings';
const THEMES_KEY='komod-markdown-custom-themes';
const HIDDEN_BUILT_INS_KEY='komod-markdown-hidden-built-ins';
function accountKey(base:string){
    const account=localStorage.getItem('komod-current-account')||'guest';
    return `${base}:${account}`;
}
function readScoped<T>(base:string,fallback:T):T{
    try{
        const scoped=localStorage.getItem(accountKey(base));
        if(scoped!==null)return JSON.parse(scoped) as T;
        const legacy=localStorage.getItem(base);
        if(legacy!==null){const parsed=JSON.parse(legacy) as T;localStorage.setItem(accountKey(base),legacy);return parsed}
    }catch{/* use fallback */}
    return fallback;
}
export function getMarkdownSettings():MarkdownSettings {
    const fallback:MarkdownSettings={
        font:localStorage.getItem('komod-reader-font')||'vazir',
        fontSize:Number(localStorage.getItem('komod-reader-font-size'))||16,
        lineHeight:Number(localStorage.getItem('komod-reader-line-height'))||2,
        align:(localStorage.getItem('komod-reader-align') as MarkdownAlign)||'right',
        direction:(localStorage.getItem('komod-reader-direction') as MarkdownDirection)||'rtl',
        textAttachmentPosition:(localStorage.getItem('komod-text-attachment-position') as 'start'|'end')||'end',
        theme:localStorage.getItem('komod-reader-tone')||'dark',
        showToolbar:localStorage.getItem('komod-reader-tools')!=='hidden',
        wrap:localStorage.getItem('komod-reader-wrap')!=='off', wide:localStorage.getItem('komod-reader-wide')==='on',
    };
    return {...fallback,...readScoped<Partial<MarkdownSettings>>(SETTINGS_KEY,{})};
}
export function saveMarkdownSettings(value:MarkdownSettings){
    localStorage.setItem(accountKey(SETTINGS_KEY),JSON.stringify(value));
    localStorage.setItem('komod-reader-font',value.font); localStorage.setItem('komod-reader-font-size',String(value.fontSize));
    localStorage.setItem('komod-reader-line-height',String(value.lineHeight)); localStorage.setItem('komod-reader-align',value.align);
    localStorage.setItem('komod-reader-direction',value.direction); localStorage.setItem('komod-text-attachment-position',value.textAttachmentPosition);
    localStorage.setItem('komod-reader-tone',value.theme); localStorage.setItem('komod-reader-tools',value.showToolbar?'visible':'hidden');
    localStorage.setItem('komod-reader-wrap',value.wrap?'on':'off'); localStorage.setItem('komod-reader-wide',value.wide?'on':'off');
    window.dispatchEvent(new CustomEvent('komod-markdown-settings-changed',{detail:value}));
}
export function getMarkdownCustomThemes():MarkdownCustomTheme[]{return readScoped<MarkdownCustomTheme[]>(THEMES_KEY,[])}
export function saveMarkdownCustomThemes(themes:MarkdownCustomTheme[]){localStorage.setItem(accountKey(THEMES_KEY),JSON.stringify(themes));window.dispatchEvent(new Event('komod-markdown-themes-changed'))}
export function getHiddenMarkdownBuiltIns():string[]{return readScoped<string[]>(HIDDEN_BUILT_INS_KEY,[])}
export function saveHiddenMarkdownBuiltIns(values:string[]){localStorage.setItem(accountKey(HIDDEN_BUILT_INS_KEY),JSON.stringify(values));window.dispatchEvent(new Event('komod-markdown-themes-changed'))}
export function getMarkdownThemeOptions(){
    const hidden=getHiddenMarkdownBuiltIns();
    return [
        ...markdownBuiltInThemes.filter(item=>!hidden.includes(item.value)).map(item=>({value:item.value,label:item.label})),
        ...getMarkdownCustomThemes().filter(item=>!item.builtIn).map(item=>({value:`custom:${item.id}`,label:`🎨 ${item.name}`})),
    ];
}
export function getMarkdownPalette(theme:string){
    const themes=getMarkdownCustomThemes();
    const custom=themes.find(item=>`custom:${item.id}`===theme);
    if(custom)return custom.palette;
    return themes.find(item=>item.builtIn===theme)?.palette;
}
