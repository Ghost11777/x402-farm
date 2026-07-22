// Prix progressifs (pattern stableenrich) : /route/partial = la même route, prix
// réduit, réponse limitée aux champs de décision. Zéro duplication : la route
// partial réécrit l'URL interne vers la route complète (même handler, même cache)
// et intercepte res.json pour ne garder que les champs clés.
// ⚠️ registerPartial DOIT être appelé AVANT la déclaration de la route complète
// sur le même router (Express ne rematche que les layers suivants après next()).
export function registerPartial(router, fullPath, pick) {
  router.all(`${fullPath}/partial`, (req, res, next) => {
    const orig = res.json.bind(res);
    res.json = (data) => {
      if (!data || data.error || data.found === false) return orig(data);
      return orig({ ...pick(data), _partial: true, version_complete: `${fullPath} (full)` });
    };
    req.url = req.url.replace(`${fullPath}/partial`, fullPath);
    next();
  });
}
