(function(){
 'use strict';
 // The legacy final evaluator is paused on every page load. This control only gates
 // Engine 5's final decision loop; shared OHLC, chart, indicator, and algorithm diagnostics remain available.
 window.RIZVI_LEGACY_ENGINE5_ENABLED=false;
 function mount(){
  if(document.getElementById('rizvi-legacy-model-control'))return;
  const button=document.createElement('button');
  button.id='rizvi-legacy-model-control';
  button.type='button';
  button.setAttribute('aria-pressed','false');
  button.style.cssText='position:fixed;right:12px;bottom:12px;z-index:2147483000;padding:10px 14px;border:1px solid #6b7280;border-radius:10px;background:#111827;color:#f9fafb;font:600 12px/1.3 system-ui,sans-serif;box-shadow:0 3px 12px rgba(0,0,0,.25);cursor:pointer;max-width:230px;text-align:left';
  function paint(enabled){
   button.setAttribute('aria-pressed',String(enabled));
   button.textContent=enabled?'Legacy Decision Model: ACTIVE — Pause':'Legacy Decision Model: PAUSED — Activate';
   button.title=enabled?'Pause the legacy Engine 5 final evaluator':'Reactivate the preserved legacy Engine 5 final evaluator';
  }
  button.addEventListener('click',function(){
   const enabled=window.RIZVI_LEGACY_ENGINE5_ENABLED!==true;
   if(typeof window.RIZVI_SET_LEGACY_ENGINE5_ENABLED!=='function'){
    button.textContent='Legacy switch unavailable — reload';
    return;
   }
   window.RIZVI_SET_LEGACY_ENGINE5_ENABLED(enabled);
   paint(enabled);
   window.dispatchEvent(new CustomEvent('rizvi:legacy-engine5-switch',{detail:{enabled,at:Date.now()}}));
  });
  paint(false);
  document.body.appendChild(button);
  if(typeof window.RIZVI_SET_LEGACY_ENGINE5_ENABLED==='function')window.RIZVI_SET_LEGACY_ENGINE5_ENABLED(false);
  else button.textContent='Legacy switch initializing…';
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();