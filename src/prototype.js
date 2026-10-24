// shortcut: browser-local demo identities, replace with server authentication before real use.
const fail=code=>{throw Object.assign(new Error(code),{code});};
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_GROUP_IMAGES=4;
export function demoAccount(profiles,email,displayName='') {
  email=String(email).trim().toLowerCase();
  if(!emailPattern.test(email)||email.length>254)fail('prototypeInvalidEmail');
  if(displayName.trim().length>70)fail('prototypeInvalidProfile');
  const existing=Object.values(profiles||{}).find(user=>user.email?.toLowerCase()===email);
  return existing?{...existing}:{id:'user-'+crypto.randomUUID(),name:displayName.trim()||email.split('@')[0],email,role:'member'};
}
export function editProfile(user,{name,email='',bio='',avatar=user.avatar}) {
  if(!user)fail('orderUnauthorized');
  name=String(name).trim();email=String(email).trim().toLowerCase();bio=String(bio).trim();
  if(!name||name.length>70||bio.length>160)fail('prototypeInvalidProfile');
  if(email&&(!emailPattern.test(email)||email.length>254))fail('prototypeInvalidEmail');
  if(avatar&&!isLocalImage(avatar))fail('prototypeInvalidImage');
  return {...user,name,email,bio,avatar};
}
export function validateImageFile(file) {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||!file.size||file.size>5*1024*1024)fail('prototypeInvalidImage');
}
export const isLocalImage=value=>typeof value==='string'&&value.length<=350000&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
export async function readLocalImage(file) {
  validateImageFile(file);
  const url=URL.createObjectURL(file),image=new Image();
  try {
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Object.assign(new Error('prototypeInvalidImage'),{code:'prototypeInvalidImage'}));image.src=url;});
    const scale=Math.min(1,1000/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const result=canvas.toDataURL('image/jpeg',.78);
    if(!isLocalImage(result))fail('prototypeImageTooLarge');
    return result;
  } finally {URL.revokeObjectURL(url);}
}
