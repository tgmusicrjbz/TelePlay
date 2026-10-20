export type MarkdownAlign = 'right'|'left'|'center'|'justify';
export type MarkdownPalette = {
    background:string; surface:string; text:string; border:string;
    heading1:string; heading2:string; heading3:string;
    bold:string; italic:string; link:string; quote:string; formula:string;
    inlineCodeText:string; inlineCodeBackground:string;
    codeText:string; codeBackground:string;
};
export type MarkdownCustomTheme = {id:string;name:string;palette:MarkdownPalette};
export type MarkdownSettings = {
    font:string; fontSize:number; lineHeight:number; align:MarkdownAlign;
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

const SETTINGS_KEY='komod-markdown-settings';
const THEMES_KEY='komod-markdown-custom-themes';
export function getMarkdownSettings():MarkdownSettings {
    const fallback:MarkdownSettings={
        font:localStorage.getItem('komod-reader-font')||'vazir',
        fontSize:Number(localStorage.getItem('komod-reader-font-size'))||16,
        lineHeight:Number(localStorage.getItem('komod-reader-line-height'))||2,
        align:(localStorage.getItem('komod-reader-align') as MarkdownAlign)||'right',
        theme:localStorage.getItem('komod-reader-tone')||'dark',
        showToolbar:localStorage.getItem('komod-reader-tools')!=='hidden',
        wrap:localStorage.getItem('komod-reader-wrap')!=='off', wide:localStorage.getItem('komod-reader-wide')==='on',
    };
    try{return {...fallback,...JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}')}}catch{return fallback}
}
export function saveMarkdownSettings(value:MarkdownSettings){
    localStorage.setItem(SETTINGS_KEY,JSON.stringify(value));
    localStorage.setItem('komod-reader-font',value.font); localStorage.setItem('komod-reader-font-size',String(value.fontSize));
    localStorage.setItem('komod-reader-line-height',String(value.lineHeight)); localStorage.setItem('komod-reader-align',value.align);
    localStorage.setItem('komod-reader-tone',value.theme); localStorage.setItem('komod-reader-tools',value.showToolbar?'visible':'hidden');
    localStorage.setItem('komod-reader-wrap',value.wrap?'on':'off'); localStorage.setItem('komod-reader-wide',value.wide?'on':'off');
    window.dispatchEvent(new CustomEvent('komod-markdown-settings-changed',{detail:value}));
}
export function getMarkdownCustomThemes():MarkdownCustomTheme[]{try{return JSON.parse(localStorage.getItem(THEMES_KEY)||'[]')}catch{return[]}}
export function saveMarkdownCustomThemes(themes:MarkdownCustomTheme[]){localStorage.setItem(THEMES_KEY,JSON.stringify(themes));window.dispatchEvent(new Event('komod-markdown-themes-changed'))}
export function getMarkdownPalette(theme:string){return getMarkdownCustomThemes().find(item=>`custom:${item.id}`===theme)?.palette}
