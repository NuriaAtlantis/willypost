' WillyPost - arranca el servidor SIN ventana (segundo plano).
'   wscript iniciar-oculto.vbs          -> arranca si no esta en marcha (lo usa el arranque automatico de Windows)
'   wscript iniciar-oculto.vbs abrir    -> ademas abre WillyPost en el navegador (lo usa el icono del Escritorio)
' Si WillyPost ya esta funcionando, no arranca otro: solo abre el navegador (con "abrir").
Option Explicit

Dim PORT
PORT = 4747

Dim fso, sh, root, nodeExe, dataDir, logDir, logFile, abrir, i, args
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

' <raiz>\scripts\windows\iniciar-oculto.vbs  ->  <raiz>
root = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))

abrir = False
If Len(sh.ExpandEnvironmentStrings("%WILLYPOST_PORT%")) > 0 And sh.ExpandEnvironmentStrings("%WILLYPOST_PORT%") <> "%WILLYPOST_PORT%" Then PORT = CLng(sh.ExpandEnvironmentStrings("%WILLYPOST_PORT%"))
Set args = WScript.Arguments
For i = 0 To args.Count - 1
  If LCase(args(i)) = "abrir" Then abrir = True
Next

Function Saludable()
  Dim http
  Saludable = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setProxy 1          ' 1 = conexion directa (sin proxy: es una direccion local)
  http.setTimeouts 1500, 1500, 1500, 1500
  http.open "GET", "http://127.0.0.1:" & PORT & "/api/health", False
  http.send
  If Err.Number = 0 Then
    If http.Status = 200 Then
      If InStr(http.responseText, """ok"":true") > 0 Or InStr(http.responseText, """ok"": true") > 0 Then Saludable = True
    End If
  End If
  On Error GoTo 0
End Function

Function LeerPrimeraLinea(ruta)
  ' Lee la primera linea de un archivo UTF-8 (con o sin BOM)
  Dim st, t, k
  LeerPrimeraLinea = ""
  On Error Resume Next
  Set st = CreateObject("ADODB.Stream")
  st.Type = 2
  st.Charset = "utf-8"
  st.Open
  st.LoadFromFile ruta
  t = st.ReadText
  st.Close
  If Err.Number = 0 Then
    t = Replace(t, vbCr, vbLf)
    k = InStr(t, vbLf)
    If k > 0 Then t = Left(t, k - 1)
    LeerPrimeraLinea = Trim(Replace(t, ChrW(&HFEFF), ""))
  End If
  On Error GoTo 0
End Function

Function BuscarNode()
  Dim p, txt
  p = root & "\runtime\node\node.exe"
  If fso.FileExists(p) Then
    BuscarNode = p
    Exit Function
  End If
  p = root & "\runtime\node-path.txt"
  If fso.FileExists(p) Then
    txt = LeerPrimeraLinea(p)
    If Len(txt) > 0 Then
      If fso.FileExists(txt) Then
        BuscarNode = txt
        Exit Function
      End If
    End If
  End If
  BuscarNode = "node"
End Function

Sub CrearCarpeta(ruta)
  If Not fso.FolderExists(ruta) Then
    CrearCarpeta fso.GetParentFolderName(ruta)
    fso.CreateFolder ruta
  End If
End Sub

If Not Saludable() Then
  dataDir = sh.ExpandEnvironmentStrings("%WILLYPOST_DATA%")
  If dataDir = "%WILLYPOST_DATA%" Or Len(dataDir) = 0 Then dataDir = sh.ExpandEnvironmentStrings("%APPDATA%") & "\WillyPost"
  logDir = dataDir & "\logs"
  On Error Resume Next
  CrearCarpeta logDir
  On Error GoTo 0
  logFile = logDir & "\servidor.log"
  ' Si el registro crece demasiado, empieza uno nuevo
  If fso.FileExists(logFile) Then
    If fso.GetFile(logFile).Size > 5000000 Then
      On Error Resume Next
      fso.DeleteFile logFile, True
      On Error GoTo 0
    End If
  End If

  nodeExe = BuscarNode()
  sh.CurrentDirectory = root
  ' cmd /c ""node" --disable-warning=ExperimentalWarning server\index.js >> "log" 2>&1"   (ventana oculta)
  sh.Run "cmd.exe /c """"" & nodeExe & """ --disable-warning=ExperimentalWarning server\index.js >> """ & logFile & """ 2>&1""", 0, False

  ' Espera hasta 30 s a que responda
  For i = 1 To 60
    WScript.Sleep 500
    If Saludable() Then Exit For
  Next
End If

If abrir Then
  If Saludable() Then
    sh.Run "http://localhost:" & PORT, 1, False
  Else
    MsgBox "WillyPost no ha podido arrancar." & vbCrLf & vbCrLf & _
           "1) Prueba a ejecutar otra vez ""Instalar WillyPost"" (repara la instalaci" & ChrW(243) & "n)." & vbCrLf & _
           "2) Si no funciona, reinicia el ordenador: puede que otro programa est" & ChrW(233) & " usando el puerto " & PORT & "." & vbCrLf & vbCrLf & _
           "El registro est" & ChrW(225) & " en:" & vbCrLf & logFile, vbExclamation, "WillyPost"
  End If
End If
