"""
Genera el diccionario ALIAS (en formato Python) a partir de
"Relacion Clientes - cuentas (corregido).xlsx" (columnas Nombre/Cliente),
para pegarlo en importar_tercera_pasada.py.
"""
import sys
import openpyxl

archivo = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\andre\Downloads\Relacion Clientes - cuentas (corregido).xlsx"
wb = openpyxl.load_workbook(archivo, data_only=True)
ws = wb["Hoja1"]
print("ALIAS = {")
for row in ws.iter_rows(min_row=2, values_only=True):
    nombre, cliente = row[0], row[1]
    if nombre and cliente:
        print(f"    {nombre!r}: {cliente!r},")
print("}")
