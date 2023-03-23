import Site from './site';

export const categoryUtils = {
  _idMap() {
    return Site.currentProp("categoriesById");
  },

      // Sort subcategories directly under parents
  sortCategories(categories) {
    const children = new Map();

    categories.forEach((category) => {
      const parentId = parseInt(category.parent_category_id, 10) || -1;
      const group = children.get(parentId) || [];
      group.pushObject(category);

      children.set(parentId, group);
    });

    const reduce = (values) =>
      values.flatMap((c) => [c, reduce(children.get(c.id) || [])]).flat();

    return reduce(children.get(-1));
  },

  findById(id) {
    if (!id) {
      return;
    }
    return categoryUtils._idMap()[id];
  },

  findByIds(ids = []) {
    const categories = [];
    ids.forEach((id) => {
      const found = categoryUtils.findById(id);
      if (found) {
        categories.push(found);
      }
    });
    return categories;
  },

};
